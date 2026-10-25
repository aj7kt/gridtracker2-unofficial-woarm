// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// BirdWatch QSO tagging (BirdWatch settings, Satellites, Logging): like the POTA and SOTA references added to a QSO a logger
// sends (sendToLogger in qso/adif.js), a QSO logged while the selected satellite is up gets PROP_MODE SAT and its SAT_NAME, so it
// is a satellite contact in the logs it goes on to (and in the Prop filter). A logger's own PROP_MODE or SAT_NAME is never replaced

function birdWatchLogTag(record)
{
  if (!GT.settings.Birdwatch.logTag || record.PROP_MODE || record.SAT_NAME) return;
  const T = GT.birdWatchTrack;
  if (!T || !T.worker || !T.selected) return;
  const sat = T.last.get(T.selected);
  const tle = birdWatchTleGet(T.selected);
  if (!sat || sat.error || !sat.up || !tle) return;
  record.PROP_MODE = "SAT";
  record.SAT_NAME = tle.name;
}

function birdWatchStickyChange()
{
  GT.settings.Birdwatch.sticky = birdWatchStickyValue.checked;
}

function birdWatchHideNoUplinkChange()
{
  GT.settings.Birdwatch.hideNoUplink = birdWatchHideNoUplinkValue.checked;
  birdWatchTransmitterWindowUpdate(true);
}

function birdWatchAutoMinElChange()
{
  GT.settings.Birdwatch.autoMinElevation = Number(birdWatchAutoMinEl.value);
  birdWatchAutoMinElText.textContent = GT.settings.Birdwatch.autoMinElevation + "°";
  if (GT.birdWatchTrack) birdWatchAutoUpdate();
}

function birdWatchSkyboxChange()
{
  GT.settings.Birdwatch.skybox = birdWatchSkyboxValue.checked;
  birdWatchPredictApply();
}

function birdWatchLogTagChange()
{
  GT.settings.Birdwatch.logTag = birdWatchLogTagValue.checked;
}
