// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// Manage Decoders... (the Mode menu's last entry): the decoders this GridTracker2 version can download, from its own signed list on the
// download server, each one's Install, Update or Remove, and each installed one's Enabled; the downloads, checks, files and the setting
// are the main window's (services/mmdPlugins.js, mmdStore*). A change is done at the next start, before any decoder is opened: Restart
// Now restarts GridTracker2 (its settings and open windows saved first), and Undo lets an install or removal go before then. Nothing is
// downloaded without a click. A paid decoder (the paid list's, kind "commercial") has Buy (its page on tagloomis.com, in the browser) and
// Enter License until a license for this call sign is entered (MMD.licenses: mmdLicenseAdd); only then Install

// The list shown ({ plugins, others }: the list's, and the installed ones it hasn't), null until it has come; a plugin being downloaded
const GETMORE = { list: null, busy: null, loading: false };

function mmdGetMoreOpen()
{
  mmdGetMoreBox.style.display = "";
  mmdGetMoreLoad();
}

function mmdGetMoreClose()
{
  mmdGetMoreBox.style.display = "none";
  mmdLicenseClose();
}

// The list asked for again (each time the box is opened: a list published since is seen)
async function mmdGetMoreLoad()
{
  if (GETMORE.loading) return;
  GETMORE.loading = true;
  mmdGetMoreStatus(I18N("mmd.store.loading"), false);
  mmdGetMoreTable.innerHTML = "";
  try
  {
    const plugins = await window.opener.mmdStoreList();
    GETMORE.list = { plugins, others: window.opener.mmdStoreInstalledOthers(plugins) };
    mmdGetMoreStatus(plugins.length ? "" : I18N("mmd.store.none"), false);
  }
  catch (e)
  {
    GETMORE.list = { plugins: [], others: window.opener.mmdStoreInstalledOthers([]) };
    mmdGetMoreStatus(e && e.status == 404 ? I18N("mmd.store.none") : I18N("mmd.store.listFailed").replace("{error}", (e && e.message) || String(e)), !(e && e.status == 404));
  }
  GETMORE.loading = false;
  mmdGetMoreRender();
}

// The line above the table: text, in the error color when error
function mmdGetMoreStatus(text, error)
{
  mmdGetMoreMessage.textContent = text;
  mmdGetMoreMessage.style.display = text ? "" : "none";
  mmdGetMoreMessage.classList.toggle("mmdGetMoreError", !!error);
}

// The table: each listed plugin, then each installed one not listed; Restart Now lit while a change waits for it (an install or removal,
// or an Enabled changed from what was loaded)
function mmdGetMoreRender()
{
  const L = GETMORE.list;
  if (!L) return;
  const rows = L.plugins.map((e) => mmdGetMoreRow(e, true)).concat(L.others.map((e) => mmdGetMoreRow(e, false)));
  const head = "<tr><th>" + I18N("mmd.store.decoder.label") + "</th><th>" + I18N("mmd.store.modes.label") + "</th><th>" + I18N("mmd.store.version.label") + "</th><th>" + I18N("mmd.store.enabled.label") + "</th><th></th></tr>";
  mmdGetMoreTable.innerHTML = rows.length ? head + rows.join("") : "";
  const all = L.plugins.concat(L.others);
  const waiting = all.some((e) => e.state == "installPending" || e.state == "removePending" || (e.found && e.enabled != e.wasEnabled) || (e.state == "locked" && e.license == "ok"));
  mmdGetMoreRestart.disabled = !waiting;
  mmdGetMoreRestart.classList.toggle("mmdGetMoreLit", waiting);
}

// One row: its name, modes, version (the list's, or the one installed), its Enabled (one found at startup, not being removed) and what
// can be done with it
function mmdGetMoreRow(e, listed)
{
  const esc = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const button = (key, action) => "<button class='cwButton' onclick=\"mmdGetMoreDo('" + e.id + "', '" + action + "');\">" + esc(I18N(key).replace("{version}", e.version)) + "</button>";
  const note = (key) => "<span class='mmdGetMoreNote'>" + esc(I18N(key)) + "</span>";
  // (a paid one without a license for this call sign: Buy, when it's listed, and Enter License in place of Install)
  const unlicensed = e.kind == "commercial" && e.license != "ok";
  const buyOrLicense = (listed && e.buy ? button("mmd.store.buy.label", "buy") + " " : "") + button("mmd.store.enterLicense.label", "license");
  let action;
  if (GETMORE.busy == e.id) action = note("mmd.store.downloading");
  else if (e.error) action = "<span class='mmdGetMoreError'>" + esc(e.error) + "</span> " + (listed ? (unlicensed && e.state == "install" ? buyOrLicense : button("mmd.store.install.label", "install")) : "");
  else if (e.state == "dev") action = note("mmd.store.dev");
  else if (e.state == "locked") action = (unlicensed ? note(e.license == "otherCall" ? "mmd.store.otherCall" : "mmd.store.noLicense") + " " + buyOrLicense : note("mmd.store.loadsOnRestart")) + " " + button("mmd.store.remove.label", "remove");
  else if (e.state == "install" && unlicensed) action = listed ? buyOrLicense : "";
  else if (e.state == "installPending") action = note("mmd.store.installPending") + " " + button("mmd.store.undo.label", "undo");
  else if (e.state == "removePending") action = note("mmd.store.removePending") + " " + button("mmd.store.undo.label", "undo");
  else if (e.state == "update") action = button("mmd.store.update.label", "install") + " " + button("mmd.store.remove.label", "remove");
  else if (e.state == "installed") action = note("mmd.store.installed") + " " + button("mmd.store.remove.label", "remove");
  else action = listed ? button("mmd.store.install.label", "install") : "";
  const enabled = e.found && e.state != "removePending"
    ? "<input type='checkbox' class='mmdGetMoreEnabled'" + (e.enabled ? " checked" : "") + " title=\"" + esc(I18N("mmd.store.enabled.hover")) + "\" onchange=\"mmdGetMoreEnabled('" + e.id + "', this.checked);\" />"
    : "";
  return "<tr><td class='mmdGetMoreName'>" + esc(e.name) + "</td><td>" + esc(e.modes.join(", ")) + "</td><td>" + esc(e.version) + "</td><td class='mmdGetMoreCheck'>" + enabled + "</td><td class='mmdGetMoreAction'>" + action + "</td></tr>";
}

// An Enabled clicked: the plugin turned on or off from the next start
function mmdGetMoreEnabled(id, on)
{
  const L = GETMORE.list;
  const e = L && L.plugins.concat(L.others).find((x) => x.id == id);
  if (!e) return;
  Object.assign(e, window.opener.mmdStoreSetEnabled(id, on));
  mmdGetMoreRender();
}

// A row's button clicked: install (or update), remove, or undo what waits for the next start. One download at a time
async function mmdGetMoreDo(id, action)
{
  const L = GETMORE.list;
  if (!L || GETMORE.busy) return;
  const listed = L.plugins.find((x) => x.id == id);
  const e = listed || L.others.find((x) => x.id == id);
  if (!e) return;
  e.error = null;
  // Buy: its page in the browser (a sub-window's window.open goes there: the main process' handler); only tagloomis.com's, as the
  // signed list has it
  if (action == "buy")
  {
    if (listed && /^https:\/\/tagloomis\.com\//.test(String(listed.buy))) window.open(listed.buy);
    return;
  }
  if (action == "license")
  {
    mmdLicenseOpen(e);
    return;
  }
  try
  {
    if (action == "install" && listed)
    {
      GETMORE.busy = id;
      mmdGetMoreRender();
      e.state = await window.opener.mmdStoreInstall(listed);
    }
    else if (action == "remove") e.state = window.opener.mmdStoreRemove(id);
    else if (action == "undo") e.state = window.opener.mmdStoreUndo(id, listed ? listed.version : null);
  }
  catch (err)
  {
    e.error = I18N("mmd.store.failed").replace("{error}", (err && err.message) || String(err));
  }
  GETMORE.busy = null;
  mmdGetMoreRender();
}

// Enter License (a paid decoder's row, e): the box under the table, for the license text sent after buying
function mmdLicenseOpen(e)
{
  mmdLicenseBox.style.display = "";
  mmdLicenseName.textContent = e.name;
  mmdLicenseText.value = "";
  mmdLicenseStatus("", false);
  mmdLicenseText.focus();
}

function mmdLicenseClose()
{
  mmdLicenseBox.style.display = "none";
}

function mmdLicenseStatus(text, error)
{
  mmdLicenseMessage.textContent = text;
  mmdLicenseMessage.style.display = text ? "" : "none";
  mmdLicenseMessage.classList.toggle("mmdGetMoreError", !!error);
}

// OK: the license checked and saved (the main window's mmdLicenseAdd: in the settings, so it goes with them). Every paid row's license
// state again: one license may be for several decoders. One for another call sign is kept too (it works when that call is set)
function mmdLicenseSave()
{
  let added;
  try
  {
    added = window.opener.mmdLicenseAdd(mmdLicenseText.value);
  }
  catch (err)
  {
    mmdLicenseStatus((err && err.message) || String(err), true);
    return;
  }
  const L = GETMORE.list;
  if (L)
  {
    for (const e of L.plugins.concat(L.others)) if (e.kind == "commercial") e.license = window.opener.mmdLicenseOf(e.id).status;
  }
  mmdGetMoreRender();
  if (added.matches)
  {
    mmdLicenseClose();
    mmdGetMoreStatus(I18N("mmd.license.added").replace("{call}", added.call), false);
  }
  else mmdLicenseStatus(I18N("mmd.license.otherCall").replace("{call}", added.call), true);
}

// Restart Now: GridTracker2 restarted, its settings and open windows saved first, so the changes are done
function mmdGetMoreRestartNow()
{
  if (mmdGetMoreRestart.disabled) return;
  window.opener.saveAndCloseApp(true);
}
