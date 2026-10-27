// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// The Multi-Mode Decoder's FT8 decoding (mmDecoder.js), in workers so the waterfall keeps drawing while a period is decoded. The one the
// page starts is the coordinator: it starts up to FT8_HELPERS more of itself (helpers; 4 threads at most in all), and each pass of a
// decode every one of them finds the same candidates in the same audio and tries its share of them (ft8wasm.c: ft8_begin and after).
// The coordinator takes what they found in candidate order (each message once, its line out), and every one takes those signals out of
// its audio before the next pass, so all stay alike; the messages decoded are the same as one thread decoding alone. ft8.wasm's bytes
// come from the page. The coordinator's messages, answered in the order sent:
//   { type: "init", wasm, audio: [fmin, fmax], passes, prefixes }
//   { type: "decode", start, samples, more, myCall, focus, deadline (Date.now() ms: candidates left untried after it), plain (Normal: ft8_lib
//   as it comes, ft8wasm.c's ft8_set_plain), ft4 (FT4 instead of FT8: ft8_set_ft4), shift (the time skew, handed back) }  ->
//   { type: "decoded", start, more, shift, count, text, ms, threads }
// A helper's (role "helper"), each answered with { type: "done", id, recs? }:
//   { type: "init", role: "helper", wasm, audio, passes }, { type: "begin", id, samples, more, myCall, focus, plain, ft4 },
//   { type: "try", id, pass, from, step }, { type: "subtract", id, recs, count, subtract } (kept for guesses; taken out if subtract),
//   { type: "failures", id } -> { fails }, { type: "remember", id, fails }

const FT8_HELPERS = 3;
// A decoded candidate's record (ft8wasm.c, REC_FIELDS floats), and where its candidate's index is in it
const FT8_REC_FIELDS = 22;
const FT8_REC_INDEX = 20;
// Another pass isn't started with less than this long (ms) to the decode's deadline
const FT8_PASS_RESERVE_MS = 250;
// A failed fine reading kept for adding to a later copy of the same message (ft8wasm.c, FAIL_FIELDS floats)
const FT8_FAIL_FIELDS = 3 + 174;

let X = null;
let myCall = null;
let recsBuffer = 0;
let failsBuffer = 0;
const helpers = [];
let nextId = 1;
const pending = {};
let queue = Promise.resolve();

function ft8Init(data)
{
  // It writes the library's info lines to stderr and formats numbers with stdio: WASI's calls answered here (a write said to have
  // written nothing is tried again for ever)
  const wasi = {
    fd_write: (fd, iovs, iovsLen, nwritten) =>
    {
      const view = new DataView(X.memory.buffer);
      let total = 0;
      for (let i = 0; i < iovsLen; i++) total += view.getUint32(iovs + i * 8 + 4, true);
      view.setUint32(nwritten, total, true);
      return 0;
    },
    // The decoder's clock (its time budget: ft8_set_budget)
    clock_time_get: (id, precision, ptr) =>
    {
      new DataView(X.memory.buffer).setBigUint64(ptr, BigInt(Math.round(performance.now() * 1e6)), true);
      return 0;
    },
    fd_close: () => 0,
    fd_seek: () => 0,
    proc_exit: (code) => { throw new Error("ft8.wasm exit " + code); }
  };
  X = new WebAssembly.Instance(new WebAssembly.Module(data.wasm), { wasi_snapshot_preview1: wasi }).exports;
  if (X._initialize) X._initialize();
  X.ft8_init(data.audio[0], data.audio[1]);
  X.ft8_set_passes(data.passes);
  // GridTracker's callsign prefixes, one a line: a decode found the harder ways whose calls have none is noise (ft8wasm.c)
  if (data.prefixes)
  {
    const p = X.ft8_prefix_buffer(data.prefixes.length);
    const bytes = new Uint8Array(X.memory.buffer, p, data.prefixes.length);
    for (let i = 0; i < data.prefixes.length; i++) bytes[i] = data.prefixes.charCodeAt(i);
    X.ft8_set_prefixes(p, data.prefixes.length);
  }
  // Room for a pass's records from every worker, and a decode's failed readings from every worker
  recsBuffer = X.malloc(600 * FT8_REC_FIELDS * 4);
  failsBuffer = X.malloc(4 * 600 * FT8_FAIL_FIELDS * 4);
  if (data.role == "helper") return;
  // The helpers: as many as the computer has cores to spare, FT8_HELPERS at most; none if workers can't start workers here
  const count = Math.min(FT8_HELPERS, Math.max(0, (self.navigator.hardwareConcurrency || 2) - 1));
  for (let i = 0; i < count; i++)
  {
    try
    {
      const helper = new Worker(self.location.href);
      helper.onmessage = (event) =>
      {
        const done = pending[event.data.id];
        if (!done) return;
        delete pending[event.data.id];
        if (event.data.type == "error") done.reject(new Error(event.data.message));
        else done.resolve(event.data);
      };
      helper.postMessage({ type: "init", role: "helper", wasm: data.wasm, audio: data.audio, passes: data.passes, prefixes: data.prefixes });
      helpers.push(helper);
    }
    catch (e)
    {
      break;
    }
  }
}

// A message to a helper, and its answer
function ft8Ask(helper, message, transfer)
{
  const id = nextId++;
  message.id = id;
  return new Promise((resolve, reject) =>
  {
    pending[id] = { resolve, reject };
    helper.postMessage(message, transfer || []);
  });
}

// This station's call to the decoder when it changes, for its a priori guess of a message to it (ft8wasm.c)
function ft8MyCall(call)
{
  if (call == myCall) return;
  myCall = call;
  const buffer = new Uint8Array(X.memory.buffer, X.ft8_mycall_buffer(), 16);
  buffer.fill(0);
  for (let i = 0; i < Math.min(call.length, 15); i++) buffer[i] = call.charCodeAt(i);
  X.ft8_set_mycall(buffer.byteOffset);
}

function ft8Begin(data)
{
  ft8MyCall(data.myCall || "");
  // FT4 or FT8 (FT4 always decoded the Normal way), then the Depth
  X.ft8_set_ft4(data.ft4 ? 1 : 0);
  X.ft8_set_plain(data.plain ? 1 : 0);
  X.ft8_set_focus(data.focus || 0);
  // The period (15 s since 1970), for guessing a QSO's next message from what was decoded two periods before (ft8_note)
  X.ft8_set_period(Math.round(data.start / 15000));
  new Float32Array(X.memory.buffer, X.ft8_input(), data.samples.length).set(data.samples);
  return X.ft8_begin(data.samples.length, data.more ? 1 : 0);
}

function ft8Records(from, count)
{
  return new Float32Array(X.memory.buffer, from, count * FT8_REC_FIELDS).slice();
}

// The coordinator: a period decoded by all of them, pass by pass
async function ft8Decode(data)
{
  const began = performance.now();
  const spent = { begin: 0, own: 0, wait: 0, subtract: 0 };
  let mark = performance.now();
  const lap = (what) => { const now = performance.now(); spent[what] += now - mark; mark = now; };
  const passes = ft8Begin(data);
  const all = helpers.length + 1;
  await Promise.all(helpers.map((helper) => ft8Ask(helper, { type: "begin", start: data.start, samples: data.samples, more: data.more, myCall: data.myCall || "", focus: data.focus || 0, plain: !!data.plain, ft4: !!data.ft4 })));
  lap("begin");
  for (let pass = 0; pass >= 0;)
  {
    // The time left (each worker's clock is its own: how long, not until when)
    const left = data.deadline ? Math.max(1, data.deadline - Date.now()) : 0;
    const asked = helpers.map((helper, k) => ft8Ask(helper, { type: "try", pass: pass, from: k + 1, step: all, left: left }));
    X.ft8_set_budget(left);
    X.ft8_pass_candidates(pass);
    const own = ft8Records(X.ft8_records(), X.ft8_try(0, all));
    lap("own");
    const theirs = await Promise.all(asked);
    lap("wait");
    // Every share's records in candidate order, as one thread would have found them
    const records = [own, ...theirs.map((answer) => answer.recs)];
    const rows = [];
    for (const recs of records) for (let i = 0; i < recs.length; i += FT8_REC_FIELDS) rows.push(recs.subarray(i, i + FT8_REC_FIELDS));
    rows.sort((a, b) => a[FT8_REC_INDEX] - b[FT8_REC_INDEX]);
    const merged = new Float32Array(X.memory.buffer, recsBuffer, rows.length * FT8_REC_FIELDS);
    rows.forEach((row, i) => merged.set(row, i * FT8_REC_FIELDS));
    const found = X.ft8_accept(recsBuffer, rows.length);
    // No further pass with too little time left for one
    const next = data.deadline && Date.now() > data.deadline - FT8_PASS_RESERVE_MS ? -1 : X.ft8_next_pass(pass, found, passes);
    if (found > 0)
    {
      // The new messages kept by every worker for later periods' guesses, and taken out of the audio if another pass follows
      const taken = ft8Records(X.ft8_subtract_records(), found);
      const subtract = next >= 0;
      const done = helpers.map((helper) => ft8Ask(helper, { type: "subtract", recs: taken, count: found, subtract: subtract }));
      new Float32Array(X.memory.buffer, recsBuffer, taken.length).set(taken);
      X.ft8_note(recsBuffer, found);
      if (subtract) X.ft8_subtract(recsBuffer, found);
      await Promise.all(done);
    }
    lap("subtract");
    pass = next;
  }
  // Every worker's failed readings, remembered by every worker (for adding to a copy of the same message two periods on)
  const fails = [ft8Failures(), ...(await Promise.all(helpers.map((helper) => ft8Ask(helper, { type: "failures" })))).map((answer) => answer.fails)];
  const total = fails.reduce((n, f) => n + f.length, 0);
  const gathered = new Float32Array(total);
  let at = 0;
  for (const f of fails)
  {
    gathered.set(f, at);
    at += f.length;
  }
  const remembered = helpers.map((helper) => ft8Ask(helper, { type: "remember", fails: gathered }));
  ft8Remember(gathered);
  await Promise.all(remembered);
  const bytes = new Uint8Array(X.memory.buffer, X.ft8_output(), 6400);
  let text = "";
  for (let k = 0; bytes[k]; k++) text += String.fromCharCode(bytes[k]);
  // ms: how long it took, on threads; the time skew (mmDecoder.js) handed back as it came
  postMessage({ type: "decoded", start: data.start, more: data.more, shift: data.shift || 0, count: X.ft8_given(), text: text, ms: Math.round(performance.now() - began), threads: all, spent: Object.fromEntries(Object.entries(spent).map(([k, v]) => [k, Math.round(v)])) });
}

// This worker's failed readings of the decode just done
function ft8Failures()
{
  return new Float32Array(X.memory.buffer, X.ft8_failures(), X.ft8_failure_count() * FT8_FAIL_FIELDS).slice();
}

function ft8Remember(fails)
{
  const count = Math.min(fails.length / FT8_FAIL_FIELDS, 4 * 600);
  new Float32Array(X.memory.buffer, failsBuffer, count * FT8_FAIL_FIELDS).set(fails.subarray(0, count * FT8_FAIL_FIELDS));
  X.ft8_remember(failsBuffer, count);
}

// A helper's part
function ft8Help(data)
{
  if (data.type == "begin") ft8Begin(data);
  else if (data.type == "try")
  {
    X.ft8_set_budget(data.left || 0);
    X.ft8_pass_candidates(data.pass);
    const recs = ft8Records(X.ft8_records(), X.ft8_try(data.from, data.step));
    postMessage({ type: "done", id: data.id, recs: recs }, [recs.buffer]);
    return;
  }
  else if (data.type == "failures")
  {
    const fails = ft8Failures();
    postMessage({ type: "done", id: data.id, fails: fails }, [fails.buffer]);
    return;
  }
  else if (data.type == "remember") ft8Remember(data.fails);
  else if (data.type == "subtract")
  {
    new Float32Array(X.memory.buffer, recsBuffer, data.recs.length).set(data.recs);
    X.ft8_note(recsBuffer, data.count);
    if (data.subtract) X.ft8_subtract(recsBuffer, data.count);
  }
  postMessage({ type: "done", id: data.id });
}

onmessage = (event) =>
{
  const data = event.data;
  try
  {
    if (data.type == "init") ft8Init(data);
    else if (data.id) ft8Help(data);
    else if (data.type == "decode" && X)
    {
      // One decode at a time (the helpers' passes in step with it)
      queue = queue.then(() => ft8Decode(data)).catch((e) => postMessage({ type: "error", message: e.message }));
    }
  }
  catch (e)
  {
    postMessage(data.id ? { type: "error", id: data.id, message: e.message } : { type: "error", message: e.message });
  }
};
