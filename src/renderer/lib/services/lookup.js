// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// Callsign lookup: QRZ, QRZCQ, HamQTH, Callook, cache and display (split out of GridTracker2.js)

// GT.settings.app keys holding [login, password] for a lookup service, or null if it needs none
function lookupCredentialKeys(service)
{
  if (service == "QRZ") return ["lookupLoginQrz", "lookupPasswordQrz"];
  if (service == "QRZCQ") return ["lookupLoginCq", "lookupPasswordCq"];
  if (service == "HAMQTH") return ["lookupLoginQth", "lookupPasswordQth"];
  return null;
}

// Display name of a lookup service, as shown in the result's "Source" row
function lookupServiceName(service)
{
  if (service == "QRZ") return "QRZ.com";
  if (service == "QRZCQ") return "QRZCQ.com";
  if (service == "HAMQTH") return "HamQTH";
  return "Callook";
}

// Lookup results are written by each station's owner on QRZ/QRZCQ/HamQTH/Callook, so treat them as
// untrusted: escape every value before it goes into the lookup window's HTML.
// htmlEntities covers & < > "; single quotes too, since many attributes here are '...'
function lookupHtml(value)
{
  return htmlEntities(value == null ? "" : value).replace(/'/g, "&#39;");
}

// A value passed as a string argument inside an onclick='...' attribute: JS-quote it, then HTML-escape
function lookupJsArg(value)
{
  return lookupHtml(JSON.stringify(String(value == null ? "" : value)));
}

// A profile "website" to open in the system browser: only http(s), since openSite hands the
// address to the operating system (a file: address could start a program). "" = no link.
function lookupWebsiteUrl(url)
{
  url = String(url).trim();
  if (/^https?:\/\//i.test(url)) return url;
  if (url.length > 0 && !/^[a-z][a-z0-9+.-]*:/i.test(url)) return "http://" + url; // e.g. "www.example.com"
  return "";
}

function loadLookupDetails()
{
  lookupService.value = GT.settings.app.lookupService;
  const keys = lookupCredentialKeys(lookupService.value);
  if (keys)
  {
    lookupLogin.value = GT.settings.app[keys[0]];
    lookupPassword.value = GT.settings.app[keys[1]];
  }
  ValidateText(lookupLogin);
  ValidateText(lookupPassword);
  if (lookupService.value == "CALLOOK") { lookupCredentials.style.display = "none"; }
  else lookupCredentials.style.display = "block";
}

function lookupValueChanged()
{
  const keys = lookupCredentialKeys(lookupService.value);
  if (GT.settings.app.lookupService != lookupService.value)
  {
    GT.lastLookupCallsign = "";
    if (keys)
    {
      lookupLogin.value = GT.settings.app[keys[0]];
      lookupPassword.value = GT.settings.app[keys[1]];
    }
  }
  GT.settings.app.lookupService = lookupService.value;
  lookupQrzTestResult.innerHTML = "";
  GT.qrzLookupSessionId = null;
  if (lookupService.value == "CALLOOK") { lookupCredentials.style.display = "none"; }
  else lookupCredentials.style.display = "block";
  if (ValidateText(lookupLogin) && ValidateText(lookupPassword) && keys)
  {
    GT.settings.app[keys[0]] = lookupLogin.value;
    GT.settings.app[keys[1]] = lookupPassword.value;
  }
}

function lookupCallsign(callsign, gridPass, useCache = true)
{
  // As a call is stored and looked up everywhere else: no spaces around it (pasted), in capitals (the prefix lookup is case-sensitive)
  callsign = String(callsign).trim().toUpperCase();
  if (GT.settings.map.offlineMode == true && useCache == false) return;
  GT.lastLookupCallsign = callsign;

  if (GT.lookupWindowInitialized)
  {
    GT.lookupWindowHandle.window.lookupCallsignInput.value = callsign;
    lookupValidateCallByElement("lookupCallsignInput");
  }
  if (GT.lookupTimeout != null)
  {
    nodeTimers.clearTimeout(GT.lookupTimeout);
    GT.lookupTimeout = null;
  }
  GT.lookupTimeout = nodeTimers.setTimeout(searchLogForCallsign, 500, callsign);

  if (useCache)
  {
    getLookupCachedObject(
      callsign,
      gridPass,
      cacheLookupObject,
      continueWithLookup
    );
  }
  else continueWithLookup(callsign, gridPass);
}

// The licence callsign inside a portable one: "W1AW/P", "KP4/W1AW" and "VE3/W1AW/M" all give "W1AW"
function lookupBaseCallsign(callsign)
{
  return String(callsign).split("/").reduce((best, part) => (part.length > best.length ? part : best), "");
}

// Callook serves the FCC licence database: the USA (840, which includes Alaska, Hawaii and the
// Marianas) plus Puerto Rico (630), Guam (316), US Virgin Is. (850) and American Samoa (16)
function isCallookCountry(ccode)
{
  return [840, 630, 316, 850, 16].includes(Number(ccode));
}

// Lookups also start automatically whenever the WSJT-X DX call changes, so replies can overlap.
// A reply is stale if a different call has been asked for since; it is still cached but not shown.
// requested is undefined for replies not tied to one call (e.g. sign-in), which are never stale.
function isStaleLookup(requested)
{
  return requested !== undefined && requested != GT.lastLookupCallsign;
}

// getBuffer onError handler: report a request that failed before any reply arrived
// (no network, DNS failure, server not answering) instead of leaving "please wait" up forever.
// With resultTd it's the settings Test button; otherwise the lookup window.
function lookupRequestFailed(resultTd, requested)
{
  return function (message)
  {
    if (resultTd == null && isStaleLookup(requested)) return;
    const html = "<span style='color:var(--gt-error)'>Lookup failed: " + htmlEntities(message) + "</span>";
    if (resultTd != null) resultTd.innerHTML = html;
    else setLookupDiv("lookupInfoDiv", html);
  };
}

function continueWithLookup(callsign, gridPass)
{
  // Not in the cache: this needs the network, so stop here in offline mode
  if (GT.settings.map.offlineMode == true) return;

  setLookupDiv(
    "lookupInfoDiv",
    "<span class='lookupWait'>Looking up <span style='color:var(--gt-callsign)'>" + lookupHtml(callsign) + "</span>, please wait...</span>"
  );

  if (GT.settings.app.lookupService != "CALLOOK")
  {
    // Without a saved login every lookup would just be a failed sign-in, so say so instead
    const keys = lookupCredentialKeys(GT.settings.app.lookupService);
    if (keys && (!GT.settings.app[keys[0]] || !GT.settings.app[keys[1]]))
    {
      setLookupDiv("lookupInfoDiv", "<br><b>Please enter your " + lookupServiceName(GT.settings.app.lookupService) + " login and password in Settings</b><br><br>");
      return;
    }

    GT.qrzLookupCallsign = callsign;
    GT.qrzLookupGrid = gridPass;
    GT.lookupSessionRetried = false;
    if (
      GT.qrzLookupSessionId == null ||
      timeNowSec() - GT.sinceLastLookup > 3600
    )
    {
      GT.qrzLookupSessionId = null;
      GT.sinceLastLookup = timeNowSec();
      getSessionId(null, true);
    }
    else
    {
      GT.sinceLastLookup = timeNowSec();
      getLookup(true);
    }
  }
  else
  {
    // Callook knows licence callsigns only, so look up the base call of a portable one
    const baseCall = lookupBaseCallsign(callsign);
    let dxcc = callsignToDxcc(baseCall);
    let where;
    let ccode = 0;
    if (dxcc in GT.dxccToAltName)
    {
      where = GT.dxccToAltName[dxcc];
      ccode = GT.dxccInfo[dxcc].ccode;
    }
    else where = "Unknown";
    if (isCallookCountry(ccode))
    {
      getBuffer(
        "https://callook.info/" + encodeURIComponent(baseCall) + "/json",
        (buffer, flag, cache) => callookResults(buffer, flag, cache, callsign),
        gridPass,
        "https",
        443,
        true,
        lookupRequestFailed(null, callsign)
      );
    }
    else
    {
      let html = ["<center>" + I18N("gt.callookDX1") +
          "<br>" + I18N("gt.callookDX2") +
          "<br>" + I18N("gt.callookDX3") + "<br>"];
      html.push(
        "<br>" + I18N("gt.callookDX4") + " <span style='color:var(--gt-callsign)'> " +
        lookupHtml(callsign) +
        "</span> " + I18N("gt.callookDX5") + " <span style='color:var(--gt-country)'> " +
        lookupHtml(where) +
        "</span><br>");
      html.push(
        "<br><br>" + I18N("gt.callookDX6") + "<br>");
      html.push(I18N("gt.callookDX7") + "<br></center>");

      setLookupDiv("lookupInfoDiv", html.join(""));
    }
  }
}

function callookResults(buffer, gridPass, useCache, requested)
{
  const show = !isStaleLookup(requested);
  try
  {
    let results = JSON.parse(buffer);
    if (typeof results.status != "undefined")
    {
      if (results.status == "VALID")
      {
        let callObject = {};
        let dxcc = callsignToDxcc(results.current.callsign);
        if (dxcc in GT.dxccToAltName) callObject.land = GT.dxccToAltName[dxcc];
        callObject.type = results.type;
        callObject.call = results.current.callsign;
        callObject.dxcc = dxcc;
        callObject.email = "";
        callObject.class = results.current.operClass;
        callObject.aliases = results.previous.callsign;
        callObject.trustee =
          results.trustee.callsign +
          (results.trustee.name.length > 0 ? "; " + results.trustee.name : "");
        callObject.name = results.name;
        callObject.fname = "";
        callObject.addr1 = results.address.line1;
        callObject.addr2 = results.address.line2;
        callObject.addrAttn = results.address.attn;
        callObject.lat = results.location.latitude;
        callObject.lon = results.location.longitude;
        callObject.grid = results.location.gridsquare;
        callObject.efdate = results.otherInfo.grantDate;
        callObject.expdate = results.otherInfo.expiryDate;
        callObject.frn = results.otherInfo.frn;
        callObject.bio = 0;
        callObject.image = "";
        callObject.country = "United States";
        if (gridPass) callObject.gtGrid = gridPass;
        callObject.source =
          "<div class='lookupLink' onClick='window.opener.openSite(\"https://callook.info/" +
          encodeURIComponent(results.current.callsign) +
          "\");'>C A L L O O K</div>";
        cacheLookupObject(callObject, gridPass, true, show);
      }
      else if (!show) return;
      else if (results.status == "INVALID")
      {
        setLookupDiv("lookupInfoDiv", "Invalid Lookup");
      }
      else
      {
        setLookupDiv("lookupInfoDiv", "Server is down for maintenance");
      }
    }
    else if (show) setLookupDiv("lookupInfoDiv", "Unknown Lookup Error");
  }
  catch (e)
  {
    // e.g. Callook sent something that isn't the JSON we expect
    console.error("callookResults", e);
    if (show) setLookupDiv("lookupInfoDiv", "Unknown Lookup Error");
  }
}

function getSessionId(resultTd, useCache)
{
  if (GT.settings.map.offlineMode == true) return;
  if (resultTd != null) resultTd.innerHTML = "Testing";
  const app = GT.settings.app;
  let url, callback;
  if (app.lookupService == "QRZCQ")
  {
    url = "https://ssl.qrzcq.com/xml?username=" + app.lookupLoginCq +
      "&password=" + encodeURIComponent(app.lookupPasswordCq) +
      "&agent=" + encodeURIComponent(gtUserAgent);
    callback = qrzGetSessionCallback;
  }
  else if (app.lookupService == "QRZ")
  {
    url = "https://xmldata.qrz.com/xml/current/?username=" + app.lookupLoginQrz +
      ";password=" + encodeURIComponent(app.lookupPasswordQrz);
    callback = qrzGetSessionCallback;
  }
  else
  {
    url = "https://www.hamqth.com/xml.php?u=" + app.lookupLoginQth +
      "&p=" + encodeURIComponent(app.lookupPasswordQth);
    callback = hamQthGetSessionCallback;
  }
  getBuffer(url, callback, resultTd, "https", 443, useCache, lookupRequestFailed(resultTd));
}

function sessionResponse(newKey, result, useCache)
{
  // for QRZCQ.com as well
  if (newKey == null)
  {
    setLookupDiv("lookupInfoDiv", result);
  }
  else
  {
    getLookup(useCache);
  }
}

function getLookup(useCache)
{
  const service = GT.settings.app.lookupService;
  const call = encodeURIComponent(GT.qrzLookupCallsign);
  let url, callback;
  if (service == "QRZCQ")
  {
    url = "https://ssl.qrzcq.com/xml?s=" + GT.qrzLookupSessionId + "&callsign=" + call + "&agent=GridTracker";
    callback = qrzLookupResults;
  }
  else if (service == "QRZ")
  {
    url = "https://xmldata.qrz.com/xml/current/?s=" + GT.qrzLookupSessionId + ";callsign=" + call;
    callback = qrzLookupResults;
  }
  else
  {
    url = "https://www.hamqth.com/xml.php?id=" + GT.qrzLookupSessionId + "&callsign=" + call + "&prg=GridTracker";
    callback = hamQthLookupResults;
  }
  const requested = GT.qrzLookupCallsign;
  getBuffer(
    url,
    (buffer, gridPass, cache) => callback(buffer, gridPass, cache, requested),
    GT.qrzLookupGrid,
    "https",
    443,
    useCache,
    lookupRequestFailed(null, requested)
  );
}

// Parses a session login reply, sets GT.qrzLookupSessionId, and returns the status HTML.
// QRZ/QRZCQ and HamQTH replies differ only in their XML tag names.
function readLookupSession(buffer, sessionTag, keyTag, errorTag)
{
  const oParser = new DOMParser();
  const oDOM = oParser.parseFromString(buffer, "text/xml");

  // DOMParser never returns null; malformed XML yields a <parsererror> node
  if (oDOM.getElementsByTagName("parsererror").length > 0)
  {
    GT.qrzLookupSessionId = null;
    return "<span style='color:var(--gt-error)'>" + I18N("gt.test.unknownError") + "</span>";
  }

  const json = XML2jsobj(oDOM.documentElement);

  if (!json.hasOwnProperty(sessionTag))
  {
    GT.qrzLookupSessionId = null;
    return "<span style='color:var(--gt-error)'>" + I18N("gt.test.invalidResponse") + "</span>";
  }

  const session = json[sessionTag];
  if (session.hasOwnProperty(keyTag))
  {
    GT.qrzLookupSessionId = session[keyTag];
    return "<span style='color:var(--gt-status-ok)'>Valid</span>";
  }

  GT.qrzLookupSessionId = null;
  return "<span style='color:var(--gt-error)'>" + lookupHtml(session[errorTag] || "Unknown Error") + "</span>";
}

// A lookup failed because the login session is no longer valid (e.g. it expired), not because
// the call wasn't found. Log in again and repeat the lookup, once. Returns true if a retry started.
function retryLookupOnSessionError(useCache)
{
  // getSessionId does nothing offline, so don't start a retry that can never finish
  if (GT.lookupSessionRetried || GT.settings.map.offlineMode == true) return false;
  GT.lookupSessionRetried = true;
  GT.qrzLookupSessionId = null;
  GT.sinceLastLookup = timeNowSec();
  getSessionId(null, useCache);
  return true;
}

function hamQthGetSessionCallback(buffer, resultTd, useCache)
{
  const result = readLookupSession(buffer, "session", "session_id", "error");

  if (resultTd == null)
  {
    // It's a true session Request
    sessionResponse(GT.qrzLookupSessionId, result, useCache);
    return;
  }

  // Settings "Test" button: never keep a session from a test
  GT.qrzLookupSessionId = null;
  resultTd.innerHTML = result;
}

function qrzGetSessionCallback(buffer, resultTd, useCache)
{
  const result = readLookupSession(buffer, "Session", "Key", "Error");

  if (resultTd == null)
  {
    // It's a true session Request
    sessionResponse(GT.qrzLookupSessionId, result, useCache);
    return;
  }

  resultTd.innerHTML = result;
}

function hamQthLookupResults(buffer, gridPass, useCache, requested)
{
  const show = !isStaleLookup(requested);
  const oParser = new DOMParser();
  const oDOM = oParser.parseFromString(buffer, "text/xml");

  // DOMParser never returns null; malformed XML yields a <parsererror> node,
  // e.g. when a proxy or the server sends an HTML error page instead
  if (oDOM.getElementsByTagName("parsererror").length > 0)
  {
    console.error("hamQthLookupResults: unexpected reply", String(buffer).substring(0, 200));
    GT.qrzLookupSessionId = null;
    if (show) setLookupDiv("lookupInfoDiv", "Unknown Lookup Error");
    return;
  }

  const json = XML2jsobj(oDOM.documentElement);

  if (!json.hasOwnProperty("search"))
  {
    GT.qrzLookupSessionId = null;
    if (!show) return;
    // HamQTH reports e.g. "Session does not exist or expired" vs "Callsign not found"
    const error = String((json.session && json.session.error) || "");
    if (/session/i.test(error))
    {
      if (retryLookupOnSessionError(useCache)) return;
      setLookupDiv("lookupInfoDiv", "<br><b>" + htmlEntities(error) + "</b><br><br>");
      return;
    }
    setLookupDiv(
      "lookupInfoDiv",
      "<br><b>" + I18N("gt.lookup.NoResult") + "</b><br><br>"
    );
    return;
  }

  const call = String(json.search.callsign || "").toUpperCase();
  const safeCall = encodeURIComponent(call);

  json.search.source =
    "<div class='lookupLink' onClick='window.opener.openSite(\"https://www.hamqth.com/" +
    safeCall +
    "\");'>HamQTH</div>";

  if (gridPass) json.search.gtGrid = gridPass;

  cacheLookupObject(json.search, gridPass, true, show);
}


function qrzLookupResults(buffer, gridPass, useCache, requested)
{
  const show = !isStaleLookup(requested);
  let oParser = new DOMParser();
  let oDOM = oParser.parseFromString(buffer, "text/xml");

  // DOMParser never returns null; malformed XML yields a <parsererror> node,
  // e.g. when a proxy or the server sends an HTML error page instead
  if (oDOM.getElementsByTagName("parsererror").length > 0)
  {
    console.error("qrzLookupResults: unexpected reply", String(buffer).substring(0, 200));
    GT.qrzLookupSessionId = null;
    if (show) setLookupDiv("lookupInfoDiv", "Unknown Lookup Error");
    return;
  }

  let json = XML2jsobj(oDOM.documentElement);

  if (!json.hasOwnProperty("Callsign"))
  {
    GT.qrzLookupSessionId = null;
    if (!show) return;
    // A reply without a session Key means our login is no longer valid (e.g. "Session Timeout");
    // with a Key it's a real "not found"
    const session = json.Session || {};
    if (!session.hasOwnProperty("Key"))
    {
      if (retryLookupOnSessionError(useCache)) return;
      if (session.Error)
      {
        setLookupDiv("lookupInfoDiv", "<br><b>" + htmlEntities(session.Error) + "</b><br><br>");
        return;
      }
    }
    setLookupDiv(
      "lookupInfoDiv",
      "<br><b>" + I18N("gt.lookup.NoResult") + "</b><br><br>"
    );
    return;
  }

  let call = "";
  if (json.Callsign.hasOwnProperty("callsign"))
  {
    json.Callsign.call = json.Callsign.callsign;
    delete json.Callsign.callsign;
  }
  if (json.Callsign.hasOwnProperty("call")) call = json.Callsign.call;

  const isQRZ = GT.settings.app.lookupService == "QRZ";
  const safeCall = encodeURIComponent(call);
  const url = isQRZ
    ? "https://www.qrz.com/lookup?callsign=" + safeCall
    : "https://www.qrzcq.com/call/" + safeCall;
  const label = isQRZ ? "QRZ.com" : "QRZCQ.com";

  // QRZCQ shows the biography on the call page; QRZ results use the qrz.com/db link (see displayLookupObject)
  if (!isQRZ) json.Callsign.bioUrl = url;

  json.Callsign.source =
    "<div class='lookupLink' onClick='window.opener.openSite(\"" +
    url +
    "\");'>" +
    label +
    "</div>";

  if (gridPass) json.Callsign.gtGrid = gridPass;

  cacheLookupObject(json.Callsign, gridPass, true, show);
}


function addLookupObjectToCache(lookupObject)
{
  GT.lookupCache[lookupObject.call] = lookupObject;
}

function getLookupCachedObject(call, gridPass, resultFunction = null, noResultFunction = null, callObject = null)
{
  if (call in GT.lookupCache)
  {
    let lookupObject = GT.lookupCache[call];
    if (callObject != null)
    {
      callObject.cnty = lookupObject.cnty;
      if (callObject.cnty in GT.countyData)
      {
        callObject.cntyQual = true;
      }
      else
      {
        callObject.cnty = null;
        callObject.cntyQual = false;
      }
      return;
    }
    if (resultFunction)
    {
      resultFunction(lookupObject, gridPass, false);
    }
  }
  else if (noResultFunction)
  {
    noResultFunction(call, gridPass);
  }
}

// display = false: cache the result and update the roster, but leave the lookup window alone
// (used for replies that a newer lookup has replaced; see isStaleLookup)
function cacheLookupObject(lookup, gridPass, cacheable = false, display = true)
{
  const hasOwn = (key) => Object.prototype.hasOwnProperty.call(lookup, key);

  const rename = (from, to) =>
  {
    if (hasOwn(from))
    {
      lookup[to] = lookup[from];
      delete lookup[from];
    }
  };

  if (!("cnty" in lookup))
  {
    lookup.cnty = null;
  }

  rename("callsign", "call");

  if (lookup.call)
  {
    lookup.call = lookup.call.toUpperCase();
  }

  rename("latitude", "lat");
  rename("longitude", "lon");
  rename("locator", "grid");

  rename("website", "url");
  rename("web", "url");

  rename("qslpic", "image");
  rename("picture", "image");

  rename("address", "addr1");
  rename("adr_city", "addr2");
  rename("city", "addr2");

  rename("itu", "ituzone");
  rename("cq", "cqzone");
  rename("adif", "dxcc");

  if (!hasOwn("dxcc") && lookup.call)
  {
    lookup.dxcc = callsignToDxcc(lookup.call);
  }

  rename("adr_name", "name");
  rename("adr_street1", "addr1");

  rename("us_state", "state");
  rename("oblast", "state");
  rename("district", "state");

  rename("adr_zip", "zip");
  rename("adr_country", "country");
  rename("us_county", "county");

  rename("qsldirect", "mqsl");
  rename("qsl", "bqsl");
  rename("utc_offset", "GMTOffset");

  rename("land", "country");

  if ("grid" in lookup && lookup.grid)
  {
    lookup.grid = lookup.grid.toUpperCase();
  }

  // Keep "GT Grid" current when a cached lookup is shown again (e.g. a portable station has moved)
  if (gridPass) lookup.gtGrid = gridPass;

  if (GT.settings.app.lookupService == "CALLOOK" && !("county" in lookup) && "lon" in lookup && "lat" in lookup)
  {
    if (GT.countyLookupReady == false) initCountyMap();
    lookup.cnty = getCountyFromLongLat(lookup.lon, lookup.lat);
    if (lookup.cnty)
    {
      lookup.county = GT.countyData[lookup.cnty].geo.properties.st + "," + GT.countyData[lookup.cnty].geo.properties.n;
      lookup.state = GT.countyData[lookup.cnty].geo.properties.st;
    }
  }
  else if (GT.countyLookupReady == true && GT.settings.app.lookupService != "CALLOOK") clearCountyMap();

  if ("state" in lookup && "county" in lookup)
  {
    let foundCounty = false;

    if (lookup.cnty == null)
    {
      if (!(lookup.county.startsWith(lookup.state + ",")))
      {
        lookup.county = lookup.state + "," + lookup.county;
      }
      lookup.cnty = lookup.county.toUpperCase().replaceAll(" ", "");
    }

    if (lookup.cnty in GT.countyData)
    {
      // Decoded and feed (DX Cluster / CW Skimmer) callsigns both appear in the roster
      for (const callsigns of [GT.liveCallsigns, GT.feedCallsigns])
      {
        for (const hash in callsigns)
        {
          if (callsigns[hash].DEcall == lookup.call && callsigns[hash].state == "US-" + lookup.state)
          {
            callsigns[hash].cnty = lookup.cnty;
            callsigns[hash].cntyQual = true;
            callsigns[hash].cntys = 0;
            foundCounty = true;
          }
        }
      }
      if (foundCounty)
      {
        goProcessRoster();
      }
    }
    else
    {
      lookup.cnty = null;
    }
  }

  if (lookup.call && lookup.grid)
  {
    if (GT.instances)
    {
      for (const instKey in GT.instances)
      {
        const inst = GT.instances[instKey];
        if (inst && inst.status && inst.status.Band && inst.status.MO)
        {
          const hash = lookup.call + inst.status.Band + inst.status.MO;
          const entry = GT.liveCallsigns[hash];
          if (entry)
          {
            if (!entry.grid)
            {
              entry.grid = lookup.grid;
              entry.gridQualified = false;
              updateLiveDistance(entry);
              goProcessRoster();
            }
          }
        }
      }
    }
  }

  lookup.name = joinSpaceIf(getLookProp(lookup, "fname"), getLookProp(lookup, "name"));
  lookup.fname = "";

  if (cacheable)
  {
    addLookupObjectToCache(lookup);
  }

  if (display) displayLookupObject(lookup, gridPass, !cacheable);
}

function displayLookupObject(lookup, gridPass, fromCache = false)
{
  const p = (key) => getLookProp(lookup, key);

  const call = p("call").toUpperCase();
  const image = p("image");
  const name = p("name");
  const addrAttn = p("addrAttn");
  const addr1 = p("addr1");
  const addr2 = joinCommaIf(p("addr2"), joinSpaceIf(p("state"), p("zip")));
  const country = p("country");
  const email = p("email");
  const url = p("url");
  const grid = p("grid");
  const gtGrid = p("gtGrid");
  const lat = p("lat");
  const lon = p("lon");

  // A tile of the Details (lookupTile), when there is a value
  const addRowIf = (arr, label, value, title = "") =>
  {
    if (value.length > 0)
    {
      arr.push(lookupTile(label, lookupHtml(value), title));
    }
  };

  const addressLines = [];
  if (addrAttn.length > 0) addressLines.push(addrAttn);
  addressLines.push(name, addr1, addr2, country);
  if (email.length > 0) addressLines.push(email);
  GT.lastLookupAddress = addressLines.join("\n") + "\n";

  // The card: the photo at the left; the call and its flag, the name and the address (a click copies them)
  const cardLines = [];
  if (addrAttn.length > 0) cardLines.push(`<div class='lookupAddr'>${lookupHtml(addrAttn)}</div>`);
  if (name.length > 0) cardLines.push(`<div class='lookupName'>${lookupHtml(name)}</div>`);
  for (const line of [addr1, addr2, country])
  {
    if (line.length > 0) cardLines.push(`<div class='lookupAddr'>${lookupHtml(line)}</div>`);
  }
  if (email.length > 0)
  {
    cardLines.push(`<div class='lookupEmail' onclick='window.opener.mailThem(${lookupJsArg(email)});'>${lookupHtml(email)}</div>`);
  }

  // Under them, the grid (a click copies it; highlighted when it is new to you), GridTracker's grid for the station when it is another
  // one, and the distance and bearing from you
  const chips = [];
  const gridChip = (label, value) =>
    `<span class='lookupChip' title='Copy to clipboard' onClick='addTextToClipboard(${lookupJsArg(value)})'><span class='lookupChipLabel'>${label}</span><span class='lookupGrid' style='${lookupGridCellStyle(value)}'>${lookupHtml(value)}</span></span>`;
  if (grid.length > 0) chips.push(gridChip("Grid", grid));
  if (gtGrid.length > 0 && gtGrid.toUpperCase() != grid.toUpperCase()) chips.push(gridChip("GT Grid", gtGrid));

  if (lat.length > 0 && lon.length > 0)
  {
    const distance = parseInt(
      MyCircle.distance(
        GT.myLat,
        GT.myLon,
        Number(lat),
        Number(lon),
        distanceUnit.value
      ) * MyCircle.validateRadius(distanceUnit.value)
    );

    const bearing = parseInt(
      MyCircle.bearing(GT.myLat, GT.myLon, Number(lat), Number(lon))
    );

    chips.push(
      `<span class='lookupChip'><span class='lookupChipLabel'>Distance</span><span style='color:var(--gt-distance)'>${distance}${distanceUnit.value.toLowerCase()}</span></span>`,
      `<span class='lookupChip'><span class='lookupChipLabel'>Azimuth</span><span style='color:var(--gt-azimuth)'>${bearing}&deg;</span></span>`
    );
  }

  const flag = lookup.dxcc > 0 && lookup.dxcc in GT.dxccInfo ? `<img class='lookupFlag' src='img/flags/24/${GT.dxccInfo[lookup.dxcc].flag}'>` : "";
  const photo = image.length > 0 ? `<img class='lookupPhoto' src='${lookupHtml(image)}'>` : "";

  const card = `
    <div class='lookupHero'>
      ${photo}
      <div>
        <div class='lookupCard' title='Click to copy address to clipboard' onclick='setClipboardFromLookup();'>
          <div class='lookupCallLine'><span class='lookupCall'>${lookupHtml(formatCallsign(call))}</span>${flag}</div>
          ${cardLines.join("")}
        </div>
        ${chips.length > 0 ? `<div class='lookupChips'>${chips.join("")}</div>` : ""}
      </div>
    </div>`;

  const detailsRows = [];

  const website = url.length > 0 ? lookupWebsiteUrl(url) : "";
  if (website.length > 0)
  {
    detailsRows.push(lookupTile("Website", `<div class='lookupLink' onClick='window.opener.openSite(${lookupJsArg(website)});'>Link</div>`));
  }

  if (Number(p("bio")) > 0)
  {
    const bioUrl = p("bioUrl") || "https://www.qrz.com/db/" + p("call");
    detailsRows.push(lookupTile("Biography", `<div class='lookupLink' onClick='window.opener.openSite(${lookupJsArg(bioUrl)});'>Link</div>`));
  }

  detailsRows.push(
    makeRow("Type", lookup, "type"),
    makeRow("Class", lookup, "class"),
    makeRow("Codes", lookup, "codes"),
    makeRow("QTH", lookup, "qth")
  );

  const dates = joinIfBothWithDash(p("efdate"), p("expdate"));
  addRowIf(detailsRows, I18N("gt.lookup.effectiveDates"), dates);

  const aliases = joinCommaIf(p("aliases"), p("p_call"));
  addRowIf(detailsRows, "Aliases", aliases, aliases);

  detailsRows.push(
    makeRow(I18N("gt.lookup.polishOT"), lookup, "plot"),
    makeRow(I18N("gt.lookup.germanDOK"), lookup, "dok"),
    makeYesNoRow(I18N("gt.lookup.sonderDOK"), lookup, "sondok"),
    lookupTile("DXCC", `${lookupHtml(p("dxcc"))} - ${lookupHtml(GT.dxccToAltName[p("dxcc")] || "Unknown")}`),
    makeRow(I18N("rosterColumns.Wanted.cqz"), lookup, "cqzone"),
    makeRow(I18N("rosterColumns.Wanted.ituz"), lookup, "ituzone"),
    makeRow("IOTA", lookup, "iota"),
    makeRow("FIPS", lookup, "fips"),
    makeRow("FRN", lookup, "frn"),
    makeRow("Timezone", lookup, "TimeZone"),
    makeRow(I18N("gt.lookup.gmtOffset"), lookup, "GMTOffset"),
    makeRow("County", lookup, "county"),
    makeRow("Latitude", lookup, "lat"),
    makeRow("Longitude", lookup, "lon")
  );

  detailsRows.push(
    makeRow("Born", lookup, "born"),
    makeYesNoRow("LoTW", lookup, "lotw"),
    makeYesNoRow("eQSL", lookup, "eqsl"),
    makeYesNoRow(I18N("gt.lookup.bureauQSL"), lookup, "bqsl"),
    makeYesNoRow(I18N("gt.lookup.mailDirectQSL"), lookup, "mqsl"),
    makeRow(I18N("gt.lookup.qslVia"), lookup, "qsl_via"),
    makeRow("QRZ Admin", lookup, "user"),
    makeRow("Prefix", lookup, "prefix"),
    lookup.source ? lookupTile("Source", lookup.source) : ""
  );

  const check = "<span class='lookupYes'>&#10004;</span>";

  if (GT.settings.callsignLookups.lotwUseEnable == true && call in GT.lotwCallsigns)
  {
    detailsRows.push(lookupTile(I18N("gt.lookup.lotwMember"), `${check} (${userDayString(GT.lotwCallsigns[call] * 86400 * 1000)})`));
  }

  if (GT.settings.callsignLookups.eqslUseEnable == true && call in GT.eqslCallsigns)
  {
    detailsRows.push(lookupTile(I18N("gt.lookup.eqslMember"), check));
  }

  if (GT.settings.callsignLookups.oqrsUseEnable == true && call in GT.oqrsCallsigns)
  {
    detailsRows.push(lookupTile("ClubLog OQRS", check));
  }

  if (fromCache)
  {
    detailsRows.push(lookupTile("Cached", "Yes"));
  }

  const details = `
    <div class='lookupDetails'>
      <div class='lookupSectionTitle'>Details</div>
      <div class='lookupTiles'>${detailsRows.join("")}</div>
    </div>`;

  const actions = `
    <div class='lookupActions'>
      <div title='Clear' class='lookupAction' onclick='window.opener.clearLookup();'>Clear</div>
      <div title='Generate Messages' class='lookupAction lookupPrimary' onclick='window.opener.setCallAndGrid(${lookupJsArg(p("call"))},${lookupJsArg(grid)});'>Generate Messages</div>
    </div>`;

  // The card first: it takes the last result's buttons and Details away with it (setLookupDiv), and this result's go in after it
  setLookupDiv("lookupInfoDiv", card);
  setLookupDiv("lookupActionsDiv", actions);
  setLookupDiv("lookupDetailsDiv", details);
}

// Back to the window's first look: an empty callsign and the hint
function clearLookup()
{
  if (GT.lookupWindowInitialized)
  {
    GT.lookupWindowHandle.window.lookupCallsignInput.value = "";
    lookupValidateCallByElement("lookupCallsignInput");
    setLookupDiv("lookupAckDiv", "");
    setLookupDiv("lookupLocalDiv", "");
    setLookupDiv("lookupInfoDiv", I18N("lookup.noinfo"));
  }
}

// A tile of the lookup's Details: its label over its value (html); title: the whole value, under the mouse
function lookupTile(label, valueHtml, title = "")
{
  return `<div class='lookupTile'${title ? ` title='${lookupHtml(title)}'` : ""}><div class='lookupTileLabel'>${label}</div><div class='lookupTileValue'>${valueHtml}</div></div>`;
}

function makeYesNoRow(first, object, key)
{
  let value = getLookProp(object, key);
  if (value.length > 0)
  {
    const yes = lookupTile(first, "<span class='lookupYes'>Yes</span>");
    const no = lookupTile(first, "<span class='lookupNo'>No</span>");
    let test = value.toUpperCase();
    if (test == "Y") return yes;
    if (test == "N") return no;
    if (test == "?") return "";
    return object[key] == 1 ? yes : no;
  }
  return "";
}

function lookupGridCellStyle(gridLocator, band, mode)
{
  const g = (gridLocator || "").substr(0, 4);
  if (!g) return "color:var(--gt-grid);";

  const b = band ?? GT.settings.app.myBand ?? "";
  const m = mode ?? GT.settings.app.myMode ?? "";
  const reference = GT.activeRoster?.logbook?.referenceNeed ?? GT.settings.roster?.logbook?.referenceNeed ?? "4";

  let suffix;
  switch (reference)
  {
    case "0": // Live Band & Mode
    case "6": // Award Tracker
      suffix = `${b}${m}`;
      break;
    case "1": // Live Band, Mix Modes
      suffix = b;
      break;
    case "2": // Live Band, Digi Modes
      suffix = `${b}dg`;
      break;
    case "3": // Mix Band, Live Mode
      suffix = m;
      break;
    case "5": // Mix Band, Digi Modes
      suffix = "dg";
      break;
    case "7": // Spots Band, Phone Modes
      suffix = `${b}ph`;
      break;
    case "8": // Spots Band, CW Mode
      suffix = `${b}CW`;
      break;
    case "9": // Mix Band & Phone Modes
      suffix = "ph";
      break;
    case "10": // Mix Band & CW Mode
      suffix = "CW";
      break;
    case "4": // Mix Band & Modes
    default:
      suffix = "";
      break;
  }

  return (g + suffix) in GT.tracker.confirmed.grid
    ? "color:var(--gt-grid);background-color:black;"
    : "color:black;background-color:cyan;";
}

function makeRow(first, object, key)
{
  let value = getLookProp(object, key);
  if (value.length > 0)
  {
    return lookupTile(first, lookupHtml(object[key].substr(0, 45)));
  }
  return "";
}

function getLookProp(object, key)
{
  return object.hasOwnProperty(key) ? object[key] : "";
}

function joinSpaceIf(first, second)
{
  if (first.length > 0 && second.length > 0) return first + " " + second;
  if (first.length > 0) return first;
  if (second.length > 0) return second;
  return "";
}

function joinCommaIf(first, second)
{
  if (first.length > 0 && second.length > 0)
  {
    if (first.indexOf(",") > -1) return first + " " + second;
    else return first + ", " + second;
  }
  if (first.length > 0) return first;
  if (second.length > 0) return second;
  return "";
}

function joinIfBothWithDash(first, second)
{
  if (first.length > 0 && second.length > 0) { return first + " / " + second; }
  return "";
}

function startLookup(call, grid)
{
  if (call == "-") return;
  if (grid == "-") grid = "";

  openLookupWindow(true);

  lookupCallsign(call, grid);
}

function changeLookupMerge()
{
  GT.settings.app.lookupMerge = lookupMerge.checked;
  GT.settings.app.lookupMissingGrid = lookupMissingGrid.checked;
  lookupMissingGridTr.style.display = GT.settings.app.lookupMerge ? "" : "none";
}

function changelookupOnTx()
{
  GT.settings.app.lookupOnTx = lookupOnTx.checked;
  GT.settings.app.lookupCloseLog = lookupCloseLog.checked;
}

// The lookup window's info part holds a lookup's card, or a message in its place (please wait, an error): whatever is written there takes
// the last result's Clear, Generate Messages and Details away with it (a result writes its own after it, displayLookupObject)
function setLookupDiv(div, worker)
{
  if (GT.lookupWindowInitialized && typeof GT.lookupWindowHandle.window[div].innerHTML != "undefined")
  {
    GT.lookupWindowHandle.window[div].innerHTML = worker;
    if (div == "lookupInfoDiv")
    {
      GT.lookupWindowHandle.window.lookupActionsDiv.innerHTML = "";
      GT.lookupWindowHandle.window.lookupDetailsDiv.innerHTML = "";
    }
  }
}

function lookupValidateCallByElement(elementString)
{
  if (GT.lookupWindowInitialized && typeof GT.lookupWindowHandle.window.validateCallByElement != "undefined")
  {
    GT.lookupWindowHandle.window.validateCallByElement(elementString);
  }
}

function openLookupWindow(show = false)
{
  if (GT.settings.map.offlineMode == true) return;

  if (GT.lookupWindowHandle == null)
  {
    GT.lookupWindowHandle = window.open("gt_lookup.html","gt_lookup");
  }
  else if (GT.lookupWindowInitialized == true)
  {
    show ? electron.ipcRenderer.send("showWin", "gt_lookup") : electron.ipcRenderer.send("hideWin", "gt_lookup");
  }
}

function toggleLookupWindow(toggle = true)
{
  if (GT.lookupWindowInitialized == true)
  {
    if (toggle)
    {
      electron.ipcRenderer.send("toggleWin", "gt_lookup");
    }
    else
    {
      electron.ipcRenderer.send("showWin", "gt_lookup");
    }
  }
}

// A band (or band and mode) as a chip in its band color, for the lookup's log: a faint dashed outline when only worked, filled when
// confirmed
function lookupBandChip(text, band, confirmed)
{
  const color = GT.bandColors[band] || "888888";
  return `<span class='lookupBand${confirmed ? " lookupConf" : ""}' style='color:#${color};${confirmed ? "background:#" + color + "48" : "border-color:#" + color + "80"}'>${text}</span>`;
}

// Your log for the call (above the Details): the bands and modes worked and confirmed, the last QSO, and its DXCC entity's bands; and
// GridTracker's acknowledgement of the call, at the top
function searchLogForCallsign(call)
{
  setLookupDiv("lookupAckDiv", "");
  setLookupDiv("lookupLocalDiv", "");
  let list = Object.values(GT.QSOhash)
    .filter(function (value)
    {
      return value.DEcall == call;
    })
    .sort(myBandCompare);

  let html = [];
  const ack = GT.acknowledgedCalls[call];

  if (ack)
  {
    setLookupDiv("lookupAckDiv", `<div class='lookupAck'>${I18N("gt.lookup.acks")} ${formatCallsign(call)} <img class="lookupAckBadge" src="img/emojis/${ack.b}.png"> ${ack.m}</div>`);
  }
  let work = {};
  let conf = {};
  let lastTime = 0;
  let lastRow = null;
  let dxcc = (list.length > 0 ? list[0].dxcc : callsignToDxcc(call));

  for (let row in list)
  {
    let what = list[row].band + "," + list[row].mode;
    if (list[row].time > lastTime)
    {
      lastRow = row;
      lastTime = list[row].time;
    }
    if (list[row].confirmed)
    {
      conf[what] = GT.bandColors[list[row].band];
      if (what in work) delete work[what];
    }
    else if (!(what in conf)) work[what] = GT.bandColors[list[row].band];
  }
  // Each row its label, then its chips (band and mode, "17m,FT8": shown as 17m FT8)
  const row = (label, color, content) => html.push(`<div class='lookupLogLabel' style='color:${color}'>${label}</div><div>${content}</div>`);
  const chips = (keys, confirmed) => keys.sort().map((key) => lookupBandChip(key.replace(",", " "), key.split(",")[0], confirmed)).join("");
  html.push("<div class='lookupLog'>");
  if (Object.keys(work).length > 0)
  {
    row("Worked", "var(--gt-worked)", chips(Object.keys(work), false));
  }
  if (Object.keys(conf).length > 0)
  {
    row("Confirmed", "var(--gt-confirmed)", chips(Object.keys(conf), true));
  }
  if (lastRow)
  {
    const last = list[lastRow];
    row(I18N("gt.lookup.lastQSO"), "var(--gt-title)","<span style='font-weight:bold;color:#" + (GT.bandColors[last.band] || "888888") + "'>" + last.band + " " + last.mode + "</span> <span class='lookupLogTime'>" + userTimeString(last.time * 1000) + "</span>");
  }

  // The entity's bands: confirmed ones filled
  const bands = [];
  for (let band in GT.colorBands)
  {
    if (String(dxcc) + "|" + GT.colorBands[band] in GT.tracker.worked.dxcc)
    {
      bands.push(lookupBandChip(GT.colorBands[band], GT.colorBands[band], String(dxcc) + "|" + GT.colorBands[band] in GT.tracker.confirmed.dxcc));
    }
  }
  row(GT.dxccToAltName[dxcc] + " (" + GT.dxccInfo[dxcc].pp + ")", "var(--gt-country)", bands.join(""));

  html.push("</div>");
  setLookupDiv("lookupLocalDiv", html.join(""));
}
