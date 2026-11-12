// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// Log a POTA / SOTA QSO (from Matt's SOTA work): click a park or summit in the Feed Roster's POTA / SOTA column (feedHandLogAllowed in
// services/sota.js: no logger such as AC Log connected, no WSJT-X / JTDX on the spot's band and mode). For QSOs nothing else logs (CW,
// SSB). The main window's Log QSO window opens (logQsoFromFeedSpot in qso/logQso.js), filled in from the spot with its park's
// POTA_REF and its summit's SOTA_REF fields, every field editable, whether or not Log QSO's buttons are on (Settings -> Logging)

// Whether a row offers it (the POTA and SOTA columns' click and hover): Feed Roster rows only
function sotaLogOffered(callObj)
{
  return isFeedRoster() && window.opener.feedHandLogAllowed(callObj);
}

function openSotaLogDialog(hash)
{
  const entry = CR.callRoster[hash];
  const callObj = entry && entry.callObj;
  if (!callObj || !sotaLogOffered(callObj)) return;
  window.opener.logQsoFromFeedSpot(callObj.hash || hash, true);
}
