// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// BirdWatch QSO tagging (BirdWatch settings, Satellites, Logging): like the POTA and SOTA references added to a QSO a logger
// sends (sendToLogger in qso/adif.js), a QSO logged while the selected satellite is up gets PROP_MODE SAT and its SAT_NAME, so it
// is a satellite contact in the logs it goes on to (and in the Prop filter). A logger's own PROP_MODE or SAT_NAME is never replaced

function birdWatchLogTag(record)
{
  if (!GT.settings.BirdWatch.logTag || record.PROP_MODE || record.SAT_NAME) return;
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
  GT.settings.BirdWatch.sticky = birdWatchStickyValue.checked;
}

function birdWatchHideNoUplinkChange()
{
  GT.settings.BirdWatch.hideNoUplink = birdWatchHideNoUplinkValue.checked;
  birdWatchTransmitterWindowUpdate(true);
}

function birdWatchAutoMinElChange()
{
  GT.settings.BirdWatch.autoMinElevation = Number(birdWatchAutoMinEl.value);
  birdWatchAutoMinElText.textContent = GT.settings.BirdWatch.autoMinElevation + "°";
  if (GT.birdWatchTrack) birdWatchAutoUpdate();
}

// BirdWatch's Rig Control (the Rig Control group's title box): the rig follows the selected satellite (Auto-Track's pick or yours); off,
// BirdWatch sends the rig nothing. Which VFOs it uses: each VFO's Satellites (Settings, Rig Control) and a transmitter's own picks
// (rigRoles)
function birdWatchAutoRigRender()
{
  birdWatchAutoRigValue.checked = GT.settings.BirdWatch.autoRig !== false;
  birdWatchLockVfosValue.checked = GT.settings.BirdWatch.lockVfos === true;
}

// Off: the satellite followed is let go at once; on: the selected one is followed from the next tick (birdWatchDopplerUpdate)
function birdWatchAutoRigChange()
{
  GT.settings.BirdWatch.autoRig = birdWatchAutoRigValue.checked;
  if (GT.settings.BirdWatch.autoRig === false) birdWatchDopplerStopFollow();
  else GT.birdWatchFollowTried = null;
  birdWatchAutoRigRender();
  birdWatchTransmitterWindowUpdate();
  // The BirdWatch panel's rig box goes with it
  rigLineRender();
}

function birdWatchSkyboxChange()
{
  GT.settings.BirdWatch.skybox = birdWatchSkyboxValue.checked;
  birdWatchPredictApply();
}

function birdWatchSideViewChange()
{
  GT.settings.BirdWatch.sideProfile = birdWatchSideProfileValue.checked;
  GT.settings.BirdWatch.sideHorizon = birdWatchSideHorizonValue.checked;
  GT.settings.BirdWatch.sideEarth = birdWatchSideEarthValue.checked;
  birdWatchPredictApply();
  if (GT.birdWatchTrack && GT.birdWatchTrack.selected) birdWatchSideViewUpdate();
}

function birdWatchLogTagChange()
{
  GT.settings.BirdWatch.logTag = birdWatchLogTagValue.checked;
}
