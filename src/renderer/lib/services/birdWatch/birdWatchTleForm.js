// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// BirdWatch's TLE form (Telemetry tab, Add > Manual, and the pencil of a manual TLE or of a tracked satellite): an element set by its
// values, each in a field of its own. The form writes the two TLE lines (the fixed columns of the standard, with their checksums); a value
// that wasn't changed keeps its text in the lines exactly as it was, so only what was edited differs from the TLE it started as

// Each value of the form. Lines: where it is in the two lines of the TLE (the first column, and how many)
//   key:      its name; label / hover: the texts in the form (hover is optional)
//   min, max: the numbers it can have (a whole number if `whole`)
const BIRD_WATCH_TLE_FIELDS = [
  { key: "norad", label: () => I18N("birdWatch.tle.form.norad"), min: 1, max: 99999, whole: true },
  { key: "revolution", label: () => I18N("birdWatch.info.revolution"), min: 0, max: 99999, whole: true },
  { key: "epoch", label: () => I18N("birdWatch.tle.form.epoch") },
  { key: "inclination", label: () => I18N("birdWatch.info.inclination"), min: 0, max: 180, line: 2, start: 8, width: 8, decimals: 4 },
  { key: "raan", label: () => I18N("birdWatch.tle.form.raan"), hover: () => I18N("birdWatch.tle.form.raan.hover"), min: 0, max: 359.9999, line: 2, start: 17, width: 8, decimals: 4 },
  { key: "eccentricity", label: () => I18N("birdWatch.tle.form.eccentricity"), min: 0, max: 0.9999999, decimals: 7 },
  { key: "argPerigee", label: () => I18N("birdWatch.tle.form.argPerigee"), min: 0, max: 359.9999, line: 2, start: 34, width: 8, decimals: 4 },
  { key: "meanAnomaly", label: () => I18N("birdWatch.tle.form.meanAnomaly"), min: 0, max: 359.9999, line: 2, start: 43, width: 8, decimals: 4 },
  { key: "meanMotion", label: () => I18N("birdWatch.tle.form.meanMotion"), hover: () => I18N("birdWatch.tle.form.meanMotion.hover"), min: 0.0001, max: 30, line: 2, start: 52, width: 11, decimals: 8 },
  { key: "bstar", label: () => I18N("birdWatch.tle.form.bstar"), hover: () => I18N("birdWatch.tle.form.bstar.hover") }
];

// The sum of a line's first 68 characters, a digit counting as itself and a minus as 1, modulo 10: its last character
function birdWatchTleChecksum(line)
{
  let total = 0;
  for (let i = 0; i < 68; i++) total += /\d/.test(line[i]) ? Number(line[i]) : (line[i] == "-" ? 1 : 0);
  return total % 10;
}

function birdWatchTlePut(line, start, text)
{
  return line.slice(0, start) + text + line.slice(start + text.length);
}

// The drag term as the TLE writes it: five digits, and the power of ten after a sign, for a number as 0.digits (" 12345-3" is 0.12345e-3).
// null when the power isn't one digit
function birdWatchTleBstarText(value)
{
  if (value == 0) return " 00000-0";
  let exponent = Math.floor(Math.log10(Math.abs(value))) + 1;
  let mantissa = Math.round(Math.abs(value) / Math.pow(10, exponent) * 1e5);
  if (mantissa >= 100000)
  {
    mantissa = 10000;
    exponent++;
  }
  if (Math.abs(exponent) > 9) return null;
  return (value < 0 ? "-" : " ") + String(mantissa).padStart(5, "0") + (exponent < 0 ? "-" : "+") + Math.abs(exponent);
}

// The values a TLE has, as the form shows them (text): { name, norad, epoch, inclination, ... }
function birdWatchTleFormValues(name, line1, line2)
{
  const year = Number(line1.slice(18, 20));
  const epoch = Date.UTC(year < 57 ? 2000 + year : 1900 + year, 0, 1) + (Number(line1.slice(20, 32)) - 1) * 86400000;
  const bstar = /^([ +-]?)(\d+)([+-]\d)$/.exec(line1.slice(53, 61).trim() == "" ? " 00000-0" : line1.slice(53, 61));
  return {
    name: name || "",
    norad: String(Number(line1.slice(2, 7))),
    epoch: new Date(Math.round(epoch)).toISOString().slice(0, 23),
    inclination: Number(line2.slice(8, 16)).toFixed(4),
    raan: Number(line2.slice(17, 25)).toFixed(4),
    eccentricity: Number("0." + line2.slice(26, 33).trim()).toFixed(7),
    argPerigee: Number(line2.slice(34, 42)).toFixed(4),
    meanAnomaly: Number(line2.slice(43, 51)).toFixed(4),
    meanMotion: Number(line2.slice(52, 63)).toFixed(8),
    bstar: bstar ? (Number(bstar[2]) == 0 ? "0" : ((bstar[1] == "-" ? -1 : 1) * Number("0." + bstar[2]) * Math.pow(10, Number(bstar[3]))).toExponential(4)) : "0",
    revolution: String(Number(line2.slice(63, 68)))
  };
}

// The two lines of a TLE that has none of its own yet: the values of the form in the columns, the rest as a TLE with nothing in it has them
function birdWatchTleBlankLines()
{
  const line1 = "1 " + "00000" + "U" + " " + "00000A  " + " " + "00" + "000.00000000" + " " + " .00000000" + " " + " 00000-0" + " " + " 00000-0" + " " + "0" + " " + "   1" + "0";
  const line2 = "2 " + "00000" + " " + "  0.0000" + " " + "  0.0000" + " " + "0000000" + " " + "  0.0000" + " " + "  0.0000" + " " + " 0.00000000" + "    0" + "0";
  return [line1, line2];
}

// The text of a TLE (name line, line 1, line 2) from the form's values; an error message, or "" when they are good. `initial`: the form's
// values as they started: one that is the same is left as it was in the lines
function birdWatchTleFormBuild(base, values, initial)
{
  const changed = (key) => values[key] !== initial[key];
  let line1 = base[0];
  let line2 = base[1];
  for (const field of BIRD_WATCH_TLE_FIELDS)
  {
    const text = String(values[field.key]).trim();
    const label = field.label();
    const range = () => ({ error: I18N("birdWatch.tle.form.check.range").replace("{field}", label).replace("{min}", field.min).replace("{max}", field.max) });
    if (field.key == "epoch")
    {
      const ms = Date.parse(text + "Z");
      const year = new Date(ms).getUTCFullYear();
      if (text == "" || !Number.isFinite(ms) || year < 1957 || year > 2056) return { error: I18N("birdWatch.tle.form.check.epoch") };
      if (!changed("epoch")) continue;
      const day = (ms - Date.UTC(year, 0, 1)) / 86400000 + 1;
      line1 = birdWatchTlePut(line1, 18, String(year % 100).padStart(2, "0") + day.toFixed(8).padStart(12, "0"));
      continue;
    }
    if (field.key == "bstar")
    {
      const value = Number(text);
      const written = text == "" || !Number.isFinite(value) ? null : birdWatchTleBstarText(value);
      if (written === null) return { error: I18N("birdWatch.tle.form.check.bstar") };
      if (changed("bstar")) line1 = birdWatchTlePut(line1, 53, written);
      continue;
    }
    const value = Number(text);
    if (text == "" || !Number.isFinite(value) || value < field.min || value > field.max || (field.whole && !Number.isInteger(value))) return range();
    if (!changed(field.key)) continue;
    if (field.key == "norad")
    {
      line1 = birdWatchTlePut(line1, 2, String(value).padStart(5, "0"));
      line2 = birdWatchTlePut(line2, 2, String(value).padStart(5, "0"));
    }
    else if (field.key == "eccentricity") line2 = birdWatchTlePut(line2, 26, String(Math.min(9999999, Math.round(value * 1e7))).padStart(7, "0"));
    else if (field.key == "revolution") line2 = birdWatchTlePut(line2, 63, String(value).padStart(5, " "));
    else line2 = birdWatchTlePut(line2, field.start, value.toFixed(field.decimals).padStart(field.width, " "));
  }
  line1 = line1.slice(0, 68) + birdWatchTleChecksum(line1);
  line2 = line2.slice(0, 68) + birdWatchTleChecksum(line2);
  return { text: (String(values.name).trim() ? String(values.name).trim() + "\n" : "") + line1 + "\n" + line2 };
}

// The form. options: name, line1, line2 (the TLE it starts as; none: a new one), fixedNorad (the catalog number can't be changed:
// it is that satellite's), onSave(text) and onCancel()
function birdWatchTleFormElement(options)
{
  const blank = !options.line1;
  const base = blank ? birdWatchTleBlankLines() : [options.line1, options.line2];
  const values = blank
    ? { name: "", norad: "", epoch: new Date().toISOString().slice(0, 23), inclination: "0", raan: "0", eccentricity: "0", argPerigee: "0", meanAnomaly: "0", meanMotion: "15", bstar: "0", revolution: "0" }
    : birdWatchTleFormValues(options.name, options.line1, options.line2);
  // A new TLE has nothing to keep as it was: every value is written
  const initial = blank ? {} : Object.assign({}, values);

  const wrap = document.createElement("div");
  wrap.className = "birdTleEditor";
  const grid = document.createElement("div");
  grid.className = "birdTleForm";
  const inputs = {};
  const add = (key, labelText, hover, span) =>
  {
    const label = document.createElement("label");
    label.className = "birdTleFormLabel";
    label.textContent = labelText;
    if (hover) label.title = hover;
    // The epoch has a line of its own
    if (key == "epoch") label.style.gridColumn = "1";
    const input = document.createElement("input");
    input.className = "inputTextValue birdTleFormInput";
    input.spellcheck = false;
    input.autocomplete = "off";
    if (key == "epoch")
    {
      input.type = "datetime-local";
      input.step = "0.001";
    }
    else input.type = "text";
    input.value = values[key];
    if (span) input.style.gridColumn = "span " + span;
    if (hover) input.title = hover;
    inputs[key] = input;
    grid.append(label, input);
    return input;
  };
  add("name", I18N("birdWatch.satellites.name.label"), "", 3).classList.add("birdTleFormWide");
  for (const field of BIRD_WATCH_TLE_FIELDS)
  {
    const input = add(field.key, field.label(), field.hover ? field.hover() : "", field.key == "epoch" ? 3 : 0);
    if (field.key == "norad" && options.fixedNorad) input.readOnly = true;
  }

  const message = document.createElement("div");
  message.className = "birdTleMessage";
  const save = birdWatchTleButton("✓", I18N("birdWatch.tle.save.hover"), () => check(true));
  const cancel = birdWatchTleButton("↩", I18N("birdWatch.tle.cancel.hover"), () => options.onCancel());
  // As it's typed: the message says whether the values make a TLE, and the ✓ waits until they do. Saved: the text goes to the caller
  const check = (saving) =>
  {
    const current = {};
    for (const key of Object.keys(inputs)) current[key] = inputs[key].value;
    const built = birdWatchTleFormBuild(base, current, initial);
    const result = built.error ? { state: "bad", message: built.error } : birdWatchTleValidate(built.text);
    message.textContent = result.message;
    message.className = "birdTleMessage" + (result.state == "ok" ? " birdTleOk" : " birdTleBad");
    save.classList.toggle("birdTleDisabled", result.state != "ok");
    if (saving === true && result.state == "ok") options.onSave(built.text);
  };
  for (const input of Object.values(inputs)) input.addEventListener("input", () => check(false));
  check(false);

  const line = document.createElement("div");
  line.className = "birdTleRow";
  line.append(save, cancel);
  wrap.append(grid, message, line);
  // The name gets the focus
  wrap.focusFirst = () => inputs.name.focus({ preventScroll: true });
  return wrap;
}
