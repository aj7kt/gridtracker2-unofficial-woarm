// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// Get More... (the Mode menu's last entry): the decoders this GridTracker2 version can download, from its own signed list on the download
// server, each one's Install, Update or Remove; the downloads, checks and files are the main window's (services/mmdPlugins.js,
// mmdStore*). A change is done at the next start, before any decoder is opened: Restart Now restarts GridTracker2 (its settings and open
// windows saved first), and Undo lets a change go before then. Nothing is downloaded without a click

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

// The table: each listed plugin, then each installed one not listed; Restart Now lit while a change waits for it
function mmdGetMoreRender()
{
  const L = GETMORE.list;
  if (!L) return;
  const rows = L.plugins.map((e) => mmdGetMoreRow(e, true)).concat(L.others.map((e) => mmdGetMoreRow(e, false)));
  const head = "<tr><th>" + I18N("mmd.store.decoder.label") + "</th><th>" + I18N("mmd.store.modes.label") + "</th><th>" + I18N("mmd.store.version.label") + "</th><th></th></tr>";
  mmdGetMoreTable.innerHTML = rows.length ? head + rows.join("") : "";
  const waiting = L.plugins.concat(L.others).some((e) => e.state == "installPending" || e.state == "removePending");
  mmdGetMoreRestart.disabled = !waiting;
  mmdGetMoreRestart.classList.toggle("mmdGetMoreLit", waiting);
}

// One row: its name, modes, version (the list's, or the one installed) and what can be done with it
function mmdGetMoreRow(e, listed)
{
  const esc = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const button = (key, action) => "<button class='cwButton' onclick=\"mmdGetMoreDo('" + e.id + "', '" + action + "');\">" + esc(I18N(key).replace("{version}", e.version)) + "</button>";
  const note = (key) => "<span class='mmdGetMoreNote'>" + esc(I18N(key)) + "</span>";
  let action;
  if (GETMORE.busy == e.id) action = note("mmd.store.downloading");
  else if (e.error) action = "<span class='mmdGetMoreError'>" + esc(e.error) + "</span> " + (listed ? button("mmd.store.install.label", "install") : "");
  else if (e.state == "dev") action = note("mmd.store.dev");
  else if (e.state == "installPending") action = note("mmd.store.installPending") + " " + button("mmd.store.undo.label", "undo");
  else if (e.state == "removePending") action = note("mmd.store.removePending") + " " + button("mmd.store.undo.label", "undo");
  else if (e.state == "update") action = button("mmd.store.update.label", "install") + " " + button("mmd.store.remove.label", "remove");
  else if (e.state == "installed") action = note("mmd.store.installed") + " " + button("mmd.store.remove.label", "remove");
  else action = listed ? button("mmd.store.install.label", "install") : "";
  return "<tr><td class='mmdGetMoreName'>" + esc(e.name) + "</td><td>" + esc(e.modes.join(", ")) + "</td><td>" + esc(e.version) + "</td><td class='mmdGetMoreAction'>" + action + "</td></tr>";
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

// Restart Now: GridTracker2 restarted, its settings and open windows saved first, so the changes are done
function mmdGetMoreRestartNow()
{
  if (mmdGetMoreRestart.disabled) return;
  window.opener.saveAndCloseApp(true);
}
