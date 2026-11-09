// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// Network Audio (turned on in Settings -> Features -> Service, its streams in the Radios tab): audio streams on the LAN as the Multi-Mode Decoder's Input and Output Devices. Each
// stream is set up in a box of its own (GT.settings.NetAudio.streams): its protocol (VBAN, RTP, PipeWire / PulseAudio's simple protocol:
// NET_AUDIO_PROTOCOLS, each in a file of its own), Input or Output, and the fields its protocol uses. A stream with Connect checked is
// open while Network Audio is on: an input listens all the time (its status says what it hears), an output is ready to send.
// The audio of a Rig Control VFO whose protocol carries it (FlexRadio DAX, Icom LAN: the protocol's audio) is listed beside them, and
// started only while the decoder uses it.
//   Each protocol: { name, dirs: ["in", "out"], fields: { in: [...], out: [...] } (the box's rows it shows), defaults, discover (optional:
//   streams announced on the LAN, for the Found menu), open(stream, dir, sink) }. A rig protocol's audio: { name, dirs, start(R, dir, sink) }.
//   sink.pcm(samples, rate): mono samples heard (an input's); sink.status(text, error): the stream's state. What open and start return:
//   { stop(), write(samples) and rate (an output's: the rate it takes its samples at) }
// The decoder's window asks by device id: "net:" and the stream's id, or "rig:" and the VFO's id (netAudioDevices)

const NET_AUDIO_PROTOCOLS = {};
const NET_AUDIO_STREAMS_MAX = 8;
// The Sample Rate menu's rates
const NET_AUDIO_RATES = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000, 88200, 96000];
// The fields a box can show, and what each is kept as
const NET_AUDIO_FIELDS = ["host", "port", "streamName", "rate", "channels", "channel"];
const NET_AUDIO_CHANNELS = ["left", "right", "mix"];

// Each stream's state, by its id: { handle (open), status, error, listeners (Map: token -> onPcm), discover (its Found menu's), found }
GT.netAudio = {};
// Each Rig Control VFO's audio in use, by device id ("rig:v1"): { handle, listeners, status, error }
GT.netAudioRigs = {};
GT.netAudioToken = 0;

function netAudioStreams()
{
  const S = GT.settings.NetAudio;
  if (!Array.isArray(S.streams)) S.streams = [];
  return S.streams;
}

function netAudioStreamById(id)
{
  return netAudioStreams().find((s) => s.id == id) || null;
}

// A stream's settings made whole: every field there, its protocol one there is, its numbers numbers
function netAudioNormalize(s)
{
  if (!(s.protocol in NET_AUDIO_PROTOCOLS)) s.protocol = Object.keys(NET_AUDIO_PROTOCOLS)[0] || "vban";
  const protocol = NET_AUDIO_PROTOCOLS[s.protocol];
  if (!protocol || !protocol.dirs.includes(s.dir)) s.dir = protocol && protocol.dirs[0] ? protocol.dirs[0] : "in";
  const defaults = (protocol && protocol.defaults) || {};
  s.host = typeof s.host == "string" ? s.host : defaults.host || "";
  s.port = Number(s.port) > 0 && Number(s.port) < 65536 ? Number(s.port) : defaults.port || 6980;
  s.streamName = typeof s.streamName == "string" ? s.streamName.slice(0, 16) : defaults.streamName || "";
  s.rate = NET_AUDIO_RATES.includes(Number(s.rate)) ? Number(s.rate) : defaults.rate || 48000;
  s.channels = Number(s.channels) == 2 ? 2 : Number(s.channels) == 1 ? 1 : defaults.channels || 1;
  s.channel = NET_AUDIO_CHANNELS.includes(s.channel) ? s.channel : defaults.channel || "left";
  s.name = typeof s.name == "string" ? s.name : "";
  s.connect = s.connect === true;
  // Announce (an RTP output's): as picked, or until it is, on for a multicast group and off for one computer's address
  if (s.announceSet !== true) s.announce = netAudioIsMulticast(s.host || defaults.host || "");
  s.announce = s.announce === true;
  return s;
}

// An IPv4 multicast address (224.0.0.0 to 239.255.255.255): the one check, the protocols' too (netAudioRtp.js)
function netAudioIsMulticast(host)
{
  const m = /^(\d{1,3})\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.exec(String(host).trim());
  return !!m && Number(m[1]) >= 224 && Number(m[1]) <= 239;
}

// The lowest id not in use ("n1", "n2" ...)
function netAudioNewId()
{
  for (let i = 1; ; i++) if (!netAudioStreamById("n" + i)) return "n" + i;
}

// ---- Startup, and each stream opened or closed as its settings say

function netAudioInit()
{
  for (const s of netAudioStreams()) netAudioNormalize(s);
  netAudioSettingsRender();
  netAudioSyncAll();
}

// Every stream opened (on, Connect checked) or closed as it should be
function netAudioSyncAll()
{
  for (const s of netAudioStreams()) netAudioSync(s);
  // The state of one removed let go
  for (const id of Object.keys(GT.netAudio)) if (!netAudioStreamById(id)) netAudioClose(id, true);
}

function netAudioWanted(s)
{
  return GT.settings.NetAudio.enable === true && s.connect === true && s.protocol in NET_AUDIO_PROTOCOLS;
}

function netAudioState(id)
{
  if (!GT.netAudio[id]) GT.netAudio[id] = { handle: null, status: "", error: false, listeners: new Map(), discover: null, found: [] };
  return GT.netAudio[id];
}

// One stream opened or closed as it should be (closed first: settings changed while it was open take effect)
function netAudioSync(s)
{
  const state = netAudioState(s.id);
  netAudioClose(s.id);
  netAudioDiscoverSync(s);
  if (!netAudioWanted(s))
  {
    netAudioSetStatus(s.id, I18N("settings.netAudio.status.off"));
    return;
  }
  const protocol = NET_AUDIO_PROTOCOLS[s.protocol];
  // What the protocol sees: a copy, so a field changed in the box meanwhile doesn't change it under the open stream
  const stream = Object.assign({}, s);
  const sink = {
    pcm: (samples, rate) => netAudioHeard(state, samples, rate),
    status: (text, error = false) => netAudioSetStatus(s.id, text, error)
  };
  try
  {
    state.handle = protocol.open(stream, s.dir, sink) || null;
  }
  catch (e)
  {
    state.handle = null;
    netAudioSetStatus(s.id, (e && e.message) || String(e), true);
  }
}

// A stream closed (its listeners told nothing: they hear silence until it opens again, or are let go with it when it is removed)
function netAudioClose(id, forget = false)
{
  const state = GT.netAudio[id];
  if (!state) return;
  if (state.handle)
  {
    try
    {
      state.handle.stop();
    }
    catch (e)
    {
      // Closed already
    }
  }
  state.handle = null;
  if (forget)
  {
    if (state.discover) netAudioDiscoverStop(state);
    delete GT.netAudio[id];
  }
}

// Samples heard on an input: to everything listening to it. A listener whose window has gone (closed, reloaded) is let go
function netAudioHeard(state, samples, rate)
{
  for (const [token, onPcm] of state.listeners)
  {
    // (An output's senders are kept here too, with nothing to tell)
    if (!onPcm) continue;
    try
    {
      onPcm(samples, rate);
    }
    catch (e)
    {
      state.listeners.delete(token);
    }
  }
}

function netAudioSetStatus(id, text, error = false)
{
  const state = netAudioState(id);
  if (state.status === text && state.error === error) return;
  state.status = text;
  state.error = error;
  netAudioStatusRender(id);
}

// ---- The Found menu: the streams a protocol has found announced on the LAN (RTP's SAP), while a box of it shows

function netAudioDiscoverSync(s)
{
  const state = netAudioState(s.id);
  const protocol = NET_AUDIO_PROTOCOLS[s.protocol];
  const wanted = GT.settings.NetAudio.enable === true && s.connect !== true && protocol && typeof protocol.discover == "function";
  const key = wanted ? s.protocol : null;
  if (state.discoverKey === key) return;
  netAudioDiscoverStop(state);
  state.discoverKey = key;
  if (!wanted) return;
  try
  {
    state.discover = protocol.discover((list) =>
    {
      state.found = Array.isArray(list) ? list : [];
      netAudioFoundRender(s.id);
    });
  }
  catch (e)
  {
    state.discover = null;
  }
}

function netAudioDiscoverStop(state)
{
  if (state.discover)
  {
    try
    {
      state.discover.stop();
    }
    catch (e)
    {
      // Stopped already
    }
  }
  state.discover = null;
  state.discoverKey = null;
  state.found = [];
}

// ---- The settings: Network Audio on or off, and a box for each stream

function netAudioSettingsRender()
{
  if (typeof netAudioEnable == "undefined") return;
  const S = GT.settings.NetAudio;
  netAudioEnable.checked = S.enable === true;
  netAudioStreamsTr.style.display = S.enable === true ? "" : "none";
  const ids = netAudioStreams().map((s) => s.id).join(",");
  if (netAudioStreamsDiv.dataset.ids != ids)
  {
    netAudioStreamsDiv.dataset.ids = ids;
    netAudioStreamsDiv.innerHTML = "";
    for (const s of netAudioStreams()) netAudioStreamsDiv.appendChild(netAudioBoxMake(s));
  }
  netAudioAddButton.style.display =netAudioStreams().length < NET_AUDIO_STREAMS_MAX ? "" : "none";
  for (const s of netAudioStreams()) netAudioBoxRender(s);
  netAudioDevicesChanged();
  // Its box in the Radios tab (panel.js)
  settingsRadiosTabRender();
}

// A stream's box: the template's, its fields' ids its own (netAudio_<id>_Protocol ...) and their labels pointed at them
function netAudioBoxMake(s)
{
  const box = netAudioTemplate.content.firstElementChild.cloneNode(true);
  box.dataset.stream = s.id;
  for (const el of box.querySelectorAll("[data-f]")) el.id = "netAudio_" + s.id + "_" + el.dataset.f;
  for (const label of box.querySelectorAll("label[data-for]")) label.htmlFor = "netAudio_" + s.id + "_" + label.dataset.for;
  renderI18n(box);
  const protocolSelect = box.querySelector("[data-f='Protocol']");
  for (const [key, protocol] of Object.entries(NET_AUDIO_PROTOCOLS)) protocolSelect.appendChild(new Option(protocol.name, key));
  const rateSelect = box.querySelector("[data-f='Rate']");
  for (const rate of NET_AUDIO_RATES) rateSelect.appendChild(new Option(rate / 1000 + " kHz", String(rate)));
  return box;
}

function netAudioEl(id, name)
{
  const box = typeof netAudioStreamsDiv == "undefined" ? null : netAudioStreamsDiv.querySelector("[data-stream='" + id + "']");
  return box ? box.querySelector("[data-f='" + name + "']") : null;
}

// The stream a field is in (its box's)
function netAudioOfEl(el)
{
  const box = el.closest("[data-stream]");
  return box ? netAudioStreamById(box.dataset.stream) : null;
}

// A box's fields from its stream: the rows its protocol uses in its direction, locked while it is connected
function netAudioBoxRender(s)
{
  const protocol = NET_AUDIO_PROTOCOLS[s.protocol];
  const fields = (protocol && protocol.fields && protocol.fields[s.dir]) || [];
  const locked = s.connect === true;
  netAudioEl(s.id, "Name").value = s.name;
  netAudioEl(s.id, "Connect").checked = locked;
  netAudioEl(s.id, "Remove").style.display = locked ? "none" : "";
  netAudioEl(s.id, "Protocol").value = s.protocol;
  // The directions the protocol has
  const dirSelect = netAudioEl(s.id, "Dir");
  for (const option of dirSelect.options) option.disabled = !protocol || !protocol.dirs.includes(option.value);
  dirSelect.value = s.dir;
  netAudioEl(s.id, "Host").value = s.host;
  netAudioEl(s.id, "Host").title = I18N(s.dir == "in" ? "settings.netAudio.host.in.hover" : "settings.netAudio.host.out.hover");
  netAudioEl(s.id, "Port").value = s.port;
  netAudioEl(s.id, "PortLabel").textContent = I18N(protocol && protocol.tcp ? "settings.rotor.tcpPort.label" : "settings.rig.udpPort.label");
  netAudioEl(s.id, "StreamName").value = s.streamName;
  netAudioEl(s.id, "StreamName").title = I18N(s.dir == "in" ? "settings.netAudio.streamName.in.hover" : "settings.netAudio.streamName.out.hover");
  netAudioEl(s.id, "Rate").value = String(s.rate);
  netAudioEl(s.id, "Rate").title = I18N("settings.netAudio.rate.hover");
  netAudioEl(s.id, "Channels").value = String(s.channels);
  netAudioEl(s.id, "Channel").value = s.channel;
  netAudioEl(s.id, "Announce").checked = s.announce === true;
  const rows = { HostTr: "host", PortTr: "port", StreamNameTr: "streamName", RateTr: "rate", ChannelTr: "channel", AnnounceTr: "announce" };
  for (const [row, field] of Object.entries(rows)) netAudioEl(s.id, row).style.display = fields.includes(field) ? "" : "none";
  // Channels beside the Sample Rate where the protocol asks for it
  netAudioEl(s.id, "Channels").style.display = fields.includes("channels") ? "" : "none";
  for (const name of ["Protocol", "Dir", "Found", "Host", "Port", "StreamName", "Rate", "Channels", "Channel", "Announce"]) rigLockField(netAudioEl(s.id, name), locked);
  netAudioFoundRender(s.id);
  netAudioStatusRender(s.id);
}

function netAudioStatusRender(id)
{
  const el = netAudioEl(id, "Status");
  if (!el) return;
  const state = GT.netAudio[id];
  const text = state ? state.status : "";
  if (el.textContent != text) el.textContent = text;
  el.style.color = state && state.error ? "var(--gt-error)" : "";
}

// The Found menu: shown while its protocol has found something, its stream not connected
function netAudioFoundRender(id)
{
  const select = netAudioEl(id, "Found");
  const s = netAudioStreamById(id);
  if (!select || !s) return;
  const state = GT.netAudio[id];
  const found = state && s.connect !== true ? state.found.filter((item) => !item.dir || item.dir == s.dir) : [];
  netAudioEl(id, "FoundTr").style.display = found.length ? "" : "none";
  const key = found.map((item) => item.label).join("|");
  if (select.dataset.key == key) return;
  select.dataset.key = key;
  select.innerHTML = "";
  const none = new Option("-", "");
  none.hidden = true;
  select.appendChild(none);
  found.forEach((item, i) => select.appendChild(new Option(item.label, String(i))));
  select.value = "";
}

function netAudioEnableChanged()
{
  GT.settings.NetAudio.enable = netAudioEnable.checked;
  netAudioSettingsRender();
  netAudioSyncAll();
}

// Add Stream: a VBAN input (the protocol listed first), not connected yet (its settings set first, then Connect checked)
function netAudioAdd()
{
  if (netAudioStreams().length >= NET_AUDIO_STREAMS_MAX) return;
  const protocol = Object.keys(NET_AUDIO_PROTOCOLS)[0] || "vban";
  const s = netAudioNormalize(Object.assign({ id: netAudioNewId(), name: "", connect: false, protocol: protocol, dir: "in" }, (NET_AUDIO_PROTOCOLS[protocol] || {}).defaults));
  netAudioStreams().push(s);
  netAudioSettingsRender();
  netAudioSync(s);
}

// A stream removed (its Connect unchecked first); what used it hears nothing until another is picked
function netAudioRemove(el)
{
  const s = netAudioOfEl(el);
  if (!s || s.connect === true) return;
  GT.settings.NetAudio.streams = netAudioStreams().filter((x) => x !== s);
  netAudioClose(s.id, true);
  netAudioSettingsRender();
}

// Connect checked or unchecked: the stream opened or closed. Checked, the decoder's device menus are made again (they list connected
// ones only), and a decoder whose Input Device it is goes to it. Unchecked, the decoder isn't told: one on it hears silence until it is
// checked again (told, it would go to the first device meanwhile, and its pick could be taken for good by a stream of the same name)
function netAudioConnectChanged(el)
{
  const s = netAudioOfEl(el);
  if (!s) return;
  s.connect = el.checked;
  netAudioBoxRender(s);
  netAudioSync(s);
  if (s.connect === true) netAudioDevicesChanged();
}

// A field changed: kept, the stream opened again with it. Another protocol: its own port (and the defaults of the fields the stream
// had none for); a direction it hasn't: its first
function netAudioFieldChanged(el)
{
  const s = netAudioOfEl(el);
  if (!s) return;
  const protocolKey = netAudioEl(s.id, "Protocol").value;
  s.name = netAudioEl(s.id, "Name").value.trim().slice(0, 24);
  if (protocolKey != s.protocol && protocolKey in NET_AUDIO_PROTOCOLS)
  {
    const defaults = NET_AUDIO_PROTOCOLS[protocolKey].defaults || {};
    s.protocol = protocolKey;
    if (defaults.port) s.port = defaults.port;
    if (!s.streamName && defaults.streamName) s.streamName = defaults.streamName;
  }
  else
  {
    s.dir = netAudioEl(s.id, "Dir").value;
    s.host = netAudioEl(s.id, "Host").value.trim();
    s.port = Number(netAudioEl(s.id, "Port").value) || s.port;
    s.streamName = netAudioEl(s.id, "StreamName").value.trim().slice(0, 16);
    s.rate = Number(netAudioEl(s.id, "Rate").value);
    s.channels = Number(netAudioEl(s.id, "Channels").value);
    s.channel = netAudioEl(s.id, "Channel").value;
  }
  netAudioNormalize(s);
  netAudioBoxRender(s);
  netAudioSync(s);
  netAudioDevicesChanged();
}

// Announce ticked or unticked: kept as picked from then on (the Host no longer decides it), the stream opened again with it
function netAudioAnnounceChanged(el)
{
  const s = netAudioOfEl(el);
  if (!s) return;
  s.announce = el.checked;
  s.announceSet = true;
  netAudioBoxRender(s);
  netAudioSync(s);
}

// A stream picked in the Found menu: its fields filled from it
function netAudioFoundPicked(el)
{
  const s = netAudioOfEl(el);
  const state = s ? GT.netAudio[s.id] : null;
  if (!state) return;
  const found = state.found.filter((item) => !item.dir || item.dir == s.dir);
  const item = found[Number(el.value)];
  if (!item) return;
  for (const field of NET_AUDIO_FIELDS) if (item.fields && item.fields[field] !== undefined) s[field] = item.fields[field];
  if (!s.name && item.name) s.name = String(item.name).slice(0, 24);
  netAudioNormalize(s);
  netAudioBoxRender(s);
}

// ---- The devices, for the Multi-Mode Decoder's menus

// The devices there are in one direction: the streams connected in it, then the Rig Control VFOs whose protocol carries audio that way
// (a rig of its own: FlexRadio, Icom LAN), as { id, label }
function netAudioDevices(dir)
{
  const list = [];
  if (GT.settings.NetAudio.enable === true)
  {
    for (const s of netAudioStreams())
    {
      if (s.dir != dir || s.connect !== true || !(s.protocol in NET_AUDIO_PROTOCOLS)) continue;
      list.push({ id: "net:" + s.id, label: NET_AUDIO_PROTOCOLS[s.protocol].name + ": " + (s.name || s.streamName || s.host || s.id) });
    }
  }
  if (GT.settings.Rigs && GT.settings.Rigs.enable)
  {
    for (const v of rigVfos())
    {
      const audio = netAudioRigAudio(v);
      if (audio && audio.dirs.includes(dir)) list.push({ id: "rig:" + v.id, label: audio.name + ": " + rigVfoLabel(v) });
    }
  }
  return list;
}

// A VFO's protocol's audio, for a rig of its own; else null
function netAudioRigAudio(v)
{
  if (!v || rigVfoIsSecond(v)) return null;
  const protocol = RIG_PROTOCOLS[v.protocol];
  return protocol && protocol.audio && typeof protocol.audio.start == "function" ? protocol.audio : null;
}

// The decoder's window told the devices changed (a stream connected, renamed, removed), so its menus are made again
function netAudioDevicesChanged()
{
  try
  {
    if (GT.mmDecoderInitialized) GT.mmDecoderHandle.window.mmdInputs();
  }
  catch (e)
  {
    // Not loaded: its menus are made as it opens
  }
}

// Listening to an input device (its id): onPcm(samples, rate) for each piece heard. The token it returns lets go of it
function netAudioListen(id, onPcm)
{
  const token = ++GT.netAudioToken;
  const [kind, key] = String(id).split(":");
  if (kind == "net")
  {
    netAudioState(key).listeners.set(token, onPcm);
    return token;
  }
  if (kind == "rig")
  {
    const use = netAudioRigUse(id, "in");
    if (!use) return null;
    use.listeners.set(token, onPcm);
    return token;
  }
  return null;
}

function netAudioUnlisten(token)
{
  if (token == null) return;
  for (const state of Object.values(GT.netAudio)) state.listeners.delete(token);
  for (const [id, use] of Object.entries(GT.netAudioRigs))
  {
    if (!use.listeners.delete(token)) continue;
    if (use.dir == "in" && use.listeners.size == 0) netAudioRigStop(id);
  }
}

// An output device (its id) to send to: { token, rate: the rate its samples are taken at }, or null (not there, not connected)
function netAudioSendStart(id)
{
  const [kind, key] = String(id).split(":");
  const token = ++GT.netAudioToken;
  if (kind == "net")
  {
    const state = GT.netAudio[key];
    if (!state || !state.handle || typeof state.handle.write != "function") return null;
    state.listeners.set(token, null);
    return { token: token, rate: state.handle.rate || netAudioStreamById(key).rate };
  }
  if (kind == "rig")
  {
    const use = netAudioRigUse(id, "out");
    if (!use || !use.handle) return null;
    use.listeners.set(token, null);
    return { token: token, rate: use.handle.rate || 48000 };
  }
  return null;
}

// Samples to send (mono, at the rate netAudioSendStart said), to the output the token is for
function netAudioSend(token, samples)
{
  for (const state of Object.values(GT.netAudio))
  {
    if (state.listeners.has(token) && state.handle && typeof state.handle.write == "function")
    {
      state.handle.write(samples);
      return true;
    }
  }
  for (const use of Object.values(GT.netAudioRigs))
  {
    if (use.dir == "out" && use.listeners.has(token) && use.handle)
    {
      use.handle.write(samples);
      return true;
    }
  }
  return false;
}

function netAudioSendStop(token)
{
  for (const state of Object.values(GT.netAudio)) state.listeners.delete(token);
  for (const [id, use] of Object.entries(GT.netAudioRigs))
  {
    if (use.dir == "out" && use.listeners.delete(token) && use.listeners.size == 0) netAudioRigStop(id);
  }
}

// What a device's status says now (the decoder shows it while it waits for the audio): its stream's, its rig audio's
function netAudioStatus(id)
{
  const [kind, key] = String(id).split(":");
  if (kind == "net")
  {
    const state = GT.netAudio[key];
    return state ? { text: state.status, error: state.error } : { text: "", error: false };
  }
  const use = GT.netAudioRigs[id + "|in"] || GT.netAudioRigs[id + "|out"];
  return use ? { text: use.status, error: use.error } : { text: "", error: false };
}

// ---- A Rig Control VFO's audio: started (the protocol's audio.start) with the first listener, stopped with the last. The protocol keeps it
// going across the rig's reconnects

function netAudioRigUse(id, dir)
{
  const key = id + "|" + dir;
  if (GT.netAudioRigs[key]) return GT.netAudioRigs[key];
  const v = rigVfoById(String(id).split(":")[1]);
  const audio = netAudioRigAudio(v);
  const R = v ? GT.rigs[v.id] : null;
  if (!audio || !R || !audio.dirs.includes(dir)) return null;
  const use = { dir: dir, handle: null, listeners: new Map(), status: "", error: false };
  GT.netAudioRigs[key] = use;
  const sink = {
    pcm: (samples, rate) => netAudioHeard(use, samples, rate),
    status: (text, error = false) =>
    {
      use.status = text;
      use.error = error;
    }
  };
  try
  {
    use.handle = audio.start(R, dir, sink) || null;
  }
  catch (e)
  {
    use.status = (e && e.message) || String(e);
    use.error = true;
  }
  return use;
}

function netAudioRigStop(id)
{
  const use = GT.netAudioRigs[id];
  if (!use) return;
  delete GT.netAudioRigs[id];
  if (use.handle)
  {
    try
    {
      use.handle.stop();
    }
    catch (e)
    {
      // Stopped already
    }
  }
}
