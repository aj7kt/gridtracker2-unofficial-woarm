// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// Settings: the settings panel and its tabs, About/Info (moved from GridTracker2.js)

function showSettingsBox()
{
  closeEventViewer();
  if (rootSettingsDiv.style.display == "inline-flex")
  {
    rootSettingsDiv.style.display = "none";
  }
  else
  {
    helpDiv.style.display = "none";
    GT.helpShow = false;
    rootSettingsDiv.style.display = "inline-flex";
    // Reopened on the About tab: its animation (aboutFx.js) starts again
    if (aboutDiv.style.display != "none") startAboutFx();
    // Reopened on one of BirdWatch's tabs: its values filled in again
    if (document.querySelector(".settingstab .birdWatchTab.active")) birdWatchSettingsTabShown();
    // The tabs fitted to the window as it is now
    settingsTabsFit();
  }
}

// Radios: its tab while Rig Control, Rotor Control or Network Audio is on (Features -> Service), a box in it for each one that is on. Gone
// while it was the tab shown: Features shows instead
function settingsRadiosTabRender()
{
  if (typeof radiosSettingsButton == "undefined") return;
  const rig = GT.settings.Rigs.enable === true;
  const rotor = GT.settings.rotor.enable === true;
  const net = GT.settings.NetAudio.enable === true;
  radiosRigGroup.style.display = rig ? "" : "none";
  radiosRotorGroup.style.display = rotor ? "" : "none";
  radiosNetAudioGroup.style.display = net ? "" : "none";
  const any = rig || rotor || net;
  const was = radiosSettingsButton.style.display != "none";
  radiosSettingsButton.style.display = any ? "" : "none";
  radiosButton.style.display = any ? "" : "none";
  if (!any && radiosSettingsButton.classList.contains("active")) openSettingsTab(featuresbut, "featuresSettingsDiv");
  if (was != any) settingsTabsFit();
}

// The button panel's Radios button: Settings open on the Radios tab, or closed when it already shows that tab
function radiosButtonClick()
{
  if (radiosSettingsButton.style.display == "none") return;
  if (rootSettingsDiv.style.display == "inline-flex" && radiosSettingsButton.classList.contains("active"))
  {
    rootSettingsDiv.style.display = "none";
    return;
  }
  closeEventViewer();
  helpDiv.style.display = "none";
  GT.helpShow = false;
  rootSettingsDiv.style.display = "inline-flex";
  openSettingsTab(radiosSettingsButton, "radiosSettingsDiv");
  settingsTabsFit();
}

// The tabs fitted to the panel: About in the main row, or, when the main row would wrap, in the row above it (BirdWatch's, shown for it
// alone while BirdWatch is off). Measured only while the panel shows (again as it opens, and as the window is resized)
function settingsTabsFit()
{
  if (typeof birdWatchTabRow == "undefined") return;
  const birdWatch = GT.settings.BirdWatch.enable === true;
  for (const button of birdWatchTabRow.querySelectorAll(".birdWatchTab")) button.style.display = birdWatch ? "" : "none";
  if (rootSettingsDiv.style.display == "inline-flex")
  {
    const row = birdWatchTabRow.parentElement;
    if (aboutbut.parentElement !== row) row.appendChild(aboutbut);
    const shown = [...row.children].filter((el) => el.classList.contains("settingsTablinks") && el.style.display != "none");
    if (shown.length > 1 && shown[shown.length - 1].offsetTop > shown[0].offsetTop + 2) birdWatchTabRow.appendChild(aboutbut);
  }
  birdWatchTabRow.style.display = birdWatch || aboutbut.parentElement === birdWatchTabRow ? "" : "none";
}

window.addEventListener("resize", () =>
{
  nodeTimers.clearTimeout(GT.settingsTabsFitTimer);
  GT.settingsTabsFitTimer = nodeTimers.setTimeout(settingsTabsFit, 200);
});

function openInfoTab(evt, tabName, callFunc, callObj)
{
  openStatsWindow();

  if (GT.statsWindowInitialized)
  {
    // Declare all variables
    let i, infoTabcontent, infoTablinks;
    // Get all elements with class="infoTabcontent" and hide them
    infoTabcontent = GT.statsWindowHandle.window.document.getElementsByClassName(
      "infoTabcontent"
    );
    for (i = 0; i < infoTabcontent.length; i++)
    {
      infoTabcontent[i].style.display = "none";
    }
    // Get all elements with class="infoTablinks" and remove the class "active"
    infoTablinks = GT.statsWindowHandle.window.document.getElementsByClassName(
      "infoTablinks"
    );
    for (i = 0; i < infoTablinks.length; i++)
    {
      infoTablinks[i].className = infoTablinks[i].className.replace(
        " active",
        ""
      );
    }
    // Show the current tab, and add an "active" class to the button that opened the tab

    GT.statsWindowHandle.window.document.getElementById(tabName).style.display = "block";

    if (evt)
    {
      evt = GT.statsWindowHandle.window.document.getElementById(evt);
    }
    if (evt)
    {
      if (typeof evt.currentTarget != "undefined")
      {
        evt.currentTarget.className += " active";
      }
      else
      {
        evt.className += " active";
      }
    }

    if (callFunc)
    {
      if (callObj) callFunc(callObj);
      else callFunc();
    }
  }
}

function openAboutBox()
{
  closeEventViewer();
  openSettingsTab(aboutbut, 'aboutDiv');
  helpDiv.style.display = "none";
  GT.helpShow = false;
  rootSettingsDiv.style.display = "inline-flex";
}

function openLogbookSettings()
{
  closeEventViewer();
  openSettingsTab(logbut, 'logbookSettingsDiv');
  helpDiv.style.display = "none";
  GT.helpShow = false;
  rootSettingsDiv.style.display = "inline-flex";
}

// rosterName: which roster's Audio Alerts to show ("call" / "feed"), from the roster window's 🔔
function openAudioAlertSettings(rosterName = null)
{
  closeEventViewer();
  if (rosterName) showAudioAlertsRoster(rosterName);
  openSettingsTab(audioalertbut, 'audioAlertsDiv');
  helpDiv.style.display = "none";
  GT.helpShow = false;
  rootSettingsDiv.style.display = "inline-flex";
  electron.ipcRenderer.send("showWin", "GridTracker2")
}

// From the roster window's Settings -> Colors: clicking the Band or Mode swatch
function openColorSettings()
{
  closeEventViewer();
  openSettingsTab(colorsSettingsButton, 'bandColorsSettingsDiv');
  helpDiv.style.display = "none";
  GT.helpShow = false;
  rootSettingsDiv.style.display = "inline-flex";
  electron.ipcRenderer.send("showWin", "GridTracker2")
}

function openSettingsTab(evt, tabName)
{
  // Declare all variables
  let i, settingsTabcontent, settingsTablinks;
  // Get all elements with class="settingsTabcontent" and hide them
  settingsTabcontent = document.getElementsByClassName("settingsTabcontent");
  for (i = 0; i < settingsTabcontent.length; i++)
  {
    settingsTabcontent[i].style.display = "none";
  }
  // Get all elements with class="settingsTablinks" and remove the class "active"
  settingsTablinks = document.getElementsByClassName("settingsTablinks");
  for (i = 0; i < settingsTablinks.length; i++)
  {
    settingsTablinks[i].className = settingsTablinks[i].className.replace(
      " active",
      ""
    );
  }
  displayCustomAlerts();
  // Show the current tab, and add an "active" class to the button that opened the tab
  document.getElementById(tabName).style.display = "";
  if (typeof evt.currentTarget != "undefined") { evt.currentTarget.className += " active"; }
  else evt.className += " active";
  // About: its animation (aboutFx.js); it stops itself when another tab shows
  if (tabName == "aboutDiv") startAboutFx();
  // One of BirdWatch's tabs: its values filled in
  if (/^birdWatch/.test(tabName)) birdWatchSettingsTabShown();
  // The tabs fitted once the panel shows (the ways in that open it on a tab show it after this)
  nodeTimers.setTimeout(settingsTabsFit, 0);
}

function initSettingsTabs()
{
  let settingsTabcontent = document.getElementsByClassName("settingsTabcontent");
  for (let i = 0; i < settingsTabcontent.length; i++)
  {
    settingsTabcontent[i].style.display = "none";
  }
  generalSettingsDiv.style.display = "";
}
