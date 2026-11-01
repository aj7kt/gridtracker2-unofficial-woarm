// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// Band plans (resources/data/bands.json, its schema beside it): each mode's usual frequencies (frequencies: the Frequency menu's,
// mmdBandFreqs). Viewed and edited in the window's Settings, Band Plans tab: an edit saves the whole file as bands.json in Ginternal,
// read from then on instead of the shipped one, until Restore Shipped deletes it

const BANDS = {
  data: null,      // the file read: { frequencies: [...] }
  edited: false,   // read from Ginternal (edited here)
  version: 0,      // counts the changes (the Frequency menu is filled again)
  mode: ""         // the frequencies shown ("": every mode's)
};
// The Mode menu's modes as the file names them
const BANDS_MODE_NAMES = { cw: "CW", ft8: "FT8", ft4: "FT4", sstv: "SSTV", packet: "Packet", psk31: "PSK31", rtty: "RTTY", mfsk: "MFSK", thor: "DominoEX", navtex: "NAVTEX", hell: "Feld-Hell", wefax: "WEFAX", olivia: "Olivia", sat: "Sat Data", wspr: "WSPR" };
const BANDS_RIG_MODES = ["USB", "LSB", "CW", "FM", "AM"];
// The modes whose Frequency menu names each frequency's station (its note): broadcasts, many stations
const BANDS_NOTE_MODES = ["wefax", "navtex"];

function mmdBandsShippedFile()
{
  return path.join(resourcesPath, "data", "bands.json");
}

function mmdBandsEditedFile()
{
  return path.join(GT.appData, "bands.json");
}

// The file: the edited one, else the shipped one (either unreadable: the other, else empty lists)
function mmdBands()
{
  if (BANDS.data) return BANDS.data;
  const read = (file) =>
  {
    try
    {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      // (An edited copy from when the file had band plans: they go with its next save)
      delete data.bandplans;
      if (!Array.isArray(data.frequencies)) data.frequencies = [];
      return data;
    }
    catch (e)
    {
      return null;
    }
  };
  const edited = fs.existsSync(mmdBandsEditedFile()) ? read(mmdBandsEditedFile()) : null;
  BANDS.edited = !!edited;
  BANDS.data = edited || read(mmdBandsShippedFile()) || { frequencies: [] };
  return BANDS.data;
}

// A mode's usual frequencies, lowest first: [[Hz, rig mode, note], ...] (none: null)
function mmdBandFreqs(mode)
{
  const name = BANDS_MODE_NAMES[mode];
  // (The file's in MHz)
  const list = mmdBands().frequencies.filter((f) => f.mode == name && f.freq > 0).sort((a, b) => a.freq - b.freq).map((f) => [Math.round(f.freq * 1e6), f.rigMode || "USB", f.note || ""]);
  return list.length ? list : null;
}

// An edit: the whole file saved in Ginternal, then read from there. A cell's edit leaves the tab as it is (redrawn, the next cell
// tabbed to would lose its focus)
function mmdBandsSave(redraw = true)
{
  try
  {
    const data = Object.assign({ $schema: "bands-schema.json" }, BANDS.data);
    fs.mkdirSync(path.dirname(mmdBandsEditedFile()), { recursive: true });
    fs.writeFileSync(mmdBandsEditedFile(), JSON.stringify(data, null, 2));
    BANDS.edited = true;
  }
  catch (e)
  {
    mmdStatus(e.message, true);
  }
  if (redraw) mmdBandsChanged();
  else
  {
    BANDS.version++;
    mmdBandsEditedNote.style.display = "";
    mmdBandsRestoreButton.style.display = "";
    mmdTop();
  }
}

// Restore Shipped: the edited file deleted, the shipped one read again
function mmdBandsRestore()
{
  try
  {
    fs.unlinkSync(mmdBandsEditedFile());
  }
  catch (e)
  {
    // None there
  }
  BANDS.data = null;
  mmdBandsChanged();
}

function mmdBandsChanged()
{
  BANDS.version++;
  mmdBandsRender();
  mmdTop();
}

// ---- The Settings tabs: Decoders, Band Plans

function mmdSettingsTab(name)
{
  // General (shown at first), Decoders, Band Plans: mmdGeneralTab and mmdGeneralTabButton ...
  for (const tab of ["general", "modes", "bands"])
  {
    const on = tab == name;
    const id = "mmd" + tab[0].toUpperCase() + tab.slice(1) + "Tab";
    window[id].style.display = on ? "" : "none";
    window[id + "Button"].classList.toggle("active", on);
  }
  if (name == "bands") mmdBandsRender();
}

// The Band Plans tab: the frequencies (by mode), each cell edited in place
function mmdBandsRender()
{
  if (mmdBandsTab.style.display == "none") return;
  const data = mmdBands();
  mmdBandsEditedNote.style.display = BANDS.edited ? "" : "none";
  mmdBandsRestoreButton.style.display = BANDS.edited ? "" : "none";

  // The frequencies: the mode menu (every mode named in the file), then its rows
  const modes = [...new Set(data.frequencies.map((f) => f.mode))].sort();
  if (BANDS.mode && !modes.includes(BANDS.mode)) BANDS.mode = "";
  mmdBandsModeSelect.length = 0;
  mmdBandsModeSelect.add(new Option(I18N("settings.bands.allModes"), ""));
  for (const m of modes) mmdBandsModeSelect.add(new Option(m, m));
  mmdBandsModeSelect.value = BANDS.mode;
  // The entry row's mode: the one shown, else the decoder's
  mmdBandsNewMode.value = BANDS.mode || BANDS_MODE_NAMES[DEC.mode] || "";
  // The entry rows' fields: their whole value in their tooltip too, as typed
  for (const el of document.querySelectorAll(".mmdBandsForm input"))
  {
    el.title = el.value;
    el.onchange = () => (el.title = el.value);
  }
  // Their frequencies typed as floats (set up once)
  if (!mmdBandsNewFreq.inputMode) mmdBandsDecimal(mmdBandsNewFreq);
  const freqs = data.frequencies.map((f, i) => [f, i]).filter(([f]) => !BANDS.mode || f.mode == BANDS.mode).sort((a, b) => (a[0].mode > b[0].mode ? 1 : a[0].mode < b[0].mode ? -1 : a[0].freq - b[0].freq));
  mmdBandsFreqRows.innerHTML = "";
  for (const [f, i] of freqs)
  {
    const row = mmdBandsFreqRows.insertRow();
    mmdBandsCell(row, f.mode, "text", 70, (v) => (f.mode = v.trim()));
    mmdBandsCell(row, f.band, "text", 50, (v) => (f.band = v.trim()));
    mmdBandsCell(row, f.freq, "number", 90, (v) => (Number(v) > 0 ? (f.freq = mmdBandsMhz(v)) : false));
    const rig = document.createElement("select");
    for (const m of BANDS_RIG_MODES) rig.add(new Option(m, m));
    rig.value = f.rigMode;
    rig.onchange = () =>
    {
      f.rigMode = rig.value;
      mmdBandsSave(false);
    };
    row.insertCell().appendChild(rig);
    mmdBandsCell(row, f.note || "", "text", 160, (v) => (v.trim() ? (f.note = v.trim()) : delete f.note));
    mmdBandsDelete(row, () => data.frequencies.splice(i, 1));
  }
}

// A frequency typed (MHz), kept to the Hz
function mmdBandsMhz(v)
{
  return Number(Number(v).toFixed(6));
}

// A frequency (MHz) shown as a float: 2 as 2.0
function mmdBandsShowMhz(v)
{
  const n = Number(v);
  return Number.isInteger(n) ? n.toFixed(1) : String(n);
}

// A frequency's field: only digits and one decimal point can be typed
function mmdBandsDecimal(input)
{
  input.inputMode = "decimal";
  input.addEventListener("input", () =>
  {
    const v = input.value.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
    if (v != input.value) input.value = v;
  });
}

// A cell edited in place: saved as it is changed (set returns false for a value it won't take: put back)
function mmdBandsCell(row, value, type, width, set)
{
  const input = document.createElement("input");
  input.type = "text";
  // A frequency (MHz): a float, typed as one (no spinner stepping by whole MHz)
  if (type == "number")
  {
    mmdBandsDecimal(input);
    value = mmdBandsShowMhz(value);
  }
  input.value = value;
  input.style.width = width + "px";
  // What doesn't fit ends in an ellipsis (CSS); its whole value in its tooltip
  input.title = String(value);
  input.onchange = () =>
  {
    if (set(input.value) === false)
    {
      input.value = value;
      return;
    }
    value = input.value;
    input.title = value;
    mmdBandsSave(false);
  };
  row.insertCell().appendChild(input);
}

// A row's delete button
function mmdBandsDelete(row, remove)
{
  const x = document.createElement("span");
  x.className = "cwButton";
  x.textContent = "×";
  x.title = I18N("settings.bands.delete.hover");
  x.onclick = () =>
  {
    remove();
    mmdBandsSave();
  };
  row.insertCell().appendChild(x);
}

function mmdBandsPickMode()
{
  BANDS.mode = mmdBandsModeSelect.value;
  mmdBandsRender();
}

// The entry row at the top of the table: Add takes what's entered there (a frequency needs its mode and MHz; a band left empty is the
// frequency's), then it's emptied for the next. A field it won't take is marked red
function mmdBandsAddFreq()
{
  const mode = mmdBandsNewMode.value.trim();
  const freq = Number(mmdBandsNewFreq.value);
  if (!mmdBandsCheck([[mmdBandsNewMode, !!mode], [mmdBandsNewFreq, freq > 0]])) return;
  const f = { mode, band: mmdBandsNewBand.value.trim() || mmdBandOf(freq * 1e6) || "", freq: mmdBandsMhz(freq), rigMode: mmdBandsNewRig.value };
  if (mmdBandsNewNote.value.trim()) f.note = mmdBandsNewNote.value.trim();
  mmdBands().frequencies.push(f);
  // Its mode shown, so it's in view
  BANDS.mode = mode;
  for (const el of [mmdBandsNewBand, mmdBandsNewFreq, mmdBandsNewNote]) el.value = "";
  mmdBandsSave();
}

// Each [field, ok]: the ones not ok outlined red until changed; true when all are
function mmdBandsCheck(list)
{
  for (const [el, ok] of list)
  {
    el.style.outline = ok ? "" : "1px solid red";
    el.oninput = () => (el.style.outline = "");
  }
  return list.every(([, ok]) => ok);
}
