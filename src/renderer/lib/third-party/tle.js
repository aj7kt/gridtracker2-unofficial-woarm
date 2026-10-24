/* eslint-disable */
/*!
 * tle.js 5.0.3 - satellite TLE parsing and orbit helpers (https://github.com/davidcalhoun/tle.js)
 * npm package tle.js@5.0.3 (ES-module source in src/), bundled to one plain script with esbuild 0.25.10:
 *   esbuild src/index.js --bundle --format=iife --global-name=tlejs --alias:satellite.js=./satellite-global.js --target=es2020
 * where satellite-global.js re-exports the functions tle.js uses (propagate, twoline2satrec, gstime, eciToEcf, eciToGeodetic, ecfToLookAngles, degreesLong, degreesLat)
 * from the global "satellite" (third-party/satellite.js), which must be loaded first.
 * Defines the global "tlejs" (e.g. tlejs.getLatLngObj(tle), tlejs.getSatelliteInfo(...)). Built by tools/build_satellite_libs.js.
 *
 * The MIT License (MIT)
 *
 * Copyright (c) 2017-2019 David Calhoun
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
var tlejs = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // ../tle/package/src/index.js
  var index_exports = {};
  __export(index_exports, {
    clearCache: () => clearCache,
    clearTLEParseCache: () => clearTLEParseCache,
    computeChecksum: () => computeChecksum,
    getAverageOrbitTimeMS: () => getAverageOrbitTimeMS,
    getAverageOrbitTimeMins: () => getAverageOrbitTimeMins,
    getAverageOrbitTimeS: () => getAverageOrbitTimeS,
    getBstarDrag: () => getBstarDrag,
    getCOSPAR: () => getCOSPAR,
    getCacheSizes: () => getCacheSizes,
    getCatalogNumber: () => getCatalogNumber1,
    getCatalogNumber1: () => getCatalogNumber1,
    getCatalogNumber2: () => getCatalogNumber2,
    getChecksum1: () => getChecksum1,
    getChecksum2: () => getChecksum2,
    getClassification: () => getClassification,
    getEccentricity: () => getEccentricity,
    getEpochDay: () => getEpochDay,
    getEpochTimestamp: () => getEpochTimestamp,
    getEpochYear: () => getEpochYear,
    getFirstTimeDerivative: () => getFirstTimeDerivative,
    getGroundTracks: () => getGroundTracks,
    getGroundTracksSync: () => getGroundTracksSync,
    getInclination: () => getInclination,
    getIntDesignatorLaunchNumber: () => getIntDesignatorLaunchNumber,
    getIntDesignatorPieceOfLaunch: () => getIntDesignatorPieceOfLaunch,
    getIntDesignatorYear: () => getIntDesignatorYear,
    getLastAntemeridianCrossingTimeMS: () => getLastAntemeridianCrossingTimeMS,
    getLatLngObj: () => getLatLngObj,
    getLineNumber1: () => getLineNumber1,
    getLineNumber2: () => getLineNumber2,
    getLngLatAtEpoch: () => getLngLatAtEpoch,
    getMeanAnomaly: () => getMeanAnomaly,
    getMeanMotion: () => getMeanMotion,
    getOrbitModel: () => getOrbitModel,
    getOrbitTrack: () => getOrbitTrack,
    getOrbitTrackSync: () => getOrbitTrackSync,
    getPerigee: () => getPerigee,
    getRevNumberAtEpoch: () => getRevNumberAtEpoch,
    getRightAscension: () => getRightAscension,
    getSatBearing: () => getSatBearing,
    getSatelliteInfo: () => getSatelliteInfo,
    getSatelliteName: () => getSatelliteName,
    getSecondTimeDerivative: () => getSecondTimeDerivative,
    getTleSetNumber: () => getTleSetNumber,
    getVisibleSatellites: () => getVisibleSatellites,
    isValidTLE: () => isValidTLE,
    parseTLE: () => parseTLE
  });

  // satellite-global.js
  var s = globalThis.satellite;
  var propagate = s.propagate;
  var twoline2satrec = s.twoline2satrec;
  var gstime = s.gstime;
  var eciToEcf = s.eciToEcf;
  var eciToGeodetic = s.eciToGeodetic;
  var ecfToLookAngles = s.ecfToLookAngles;
  var degreesLong = s.degreesLong;
  var degreesLat = s.degreesLat;

  // ../tle/package/src/constants.js
  var _MS_IN_A_DAY = 864e5;
  var _MS_IN_A_SECOND = 1e3;
  var _MS_IN_A_MINUTE = 6e4;
  var _TLE_DATA_TYPES = {
    _INT: Symbol(),
    _FLOAT: Symbol(),
    _CHAR: Symbol(),
    _DECIMAL_ASSUMED: Symbol(),
    // 12345 -> 0.12345
    _DECIMAL_ASSUMED_E: Symbol()
    // 12345-2 -> 0.0012345
  };
  var _DATA_TYPES = {
    _ARRAY: "array",
    _STRING: "string",
    _OBJECT: "object",
    _DATE: "date",
    _NAN: "NaN"
  };
  var _ACCEPTABLE_TLE_INPUT_TYPES = {
    _STRING: _DATA_TYPES._STRING,
    _ARRAY: _DATA_TYPES._ARRAY,
    _OBJECT: _DATA_TYPES._OBJECT
  };

  // ../tle/package/src/utils.js
  function getType(input) {
    const type = typeof input;
    if (Array.isArray(input)) {
      return _DATA_TYPES._ARRAY;
    }
    if (input instanceof Date) {
      return _DATA_TYPES._DATE;
    }
    if (Number.isNaN(input)) {
      return _DATA_TYPES._NAN;
    }
    return type;
  }
  var _isPositive = (num) => num >= 0;
  var _getDigitCount = (num) => {
    const absVal = Math.abs(num);
    return absVal.toString().length;
  };
  var _toLeadingDecimal = (num) => {
    const numDigits = _getDigitCount(num);
    const zeroes = "0".repeat(numDigits - 1);
    return parseFloat(num * `0.${zeroes}1`);
  };
  var _decimalAssumedEToFloat = (str) => {
    const numWithAssumedLeadingDecimal = str.substr(0, str.length - 2);
    const num = _toLeadingDecimal(numWithAssumedLeadingDecimal);
    const leadingDecimalPoints = parseInt(str.substr(str.length - 2, 2), 10);
    const float = num * Math.pow(10, leadingDecimalPoints);
    return parseFloat(float.toPrecision(5));
  };
  var _dayOfYearToTimeStamp = (dayOfYear, year = (/* @__PURE__ */ new Date()).getFullYear()) => {
    const yearStart = /* @__PURE__ */ new Date(`1/1/${year} 0:0:0 Z`);
    const yearStartMS = yearStart.getTime();
    return Math.floor(yearStartMS + (dayOfYear - 1) * _MS_IN_A_DAY);
  };
  var _radiansToDegrees = (radians) => radians * (180 / Math.PI);
  var _degreesToRadians = (degrees) => degrees * (Math.PI / 180);
  var _crossesAntemeridian = (longitude1, longitude2) => {
    if (!longitude1 || !longitude2) return false;
    const isLong1Positive = _isPositive(longitude1);
    const isLong2Positive = _isPositive(longitude2);
    const haveSameSigns = isLong1Positive === isLong2Positive;
    if (haveSameSigns) return false;
    const isNearAntemeridian = Math.abs(longitude1) > 100;
    return isNearAntemeridian;
  };
  function _getFullYear(twoDigitYear) {
    const twoDigitYearInt = parseInt(twoDigitYear, 10);
    return twoDigitYearInt < 100 && twoDigitYearInt > 56 ? twoDigitYearInt + 1900 : twoDigitYearInt + 2e3;
  }
  function getFromTLE(parsedTLE, lineNumber, definition) {
    const { tle } = parsedTLE;
    const line = lineNumber === 1 ? tle[0] : tle[1];
    const { start, length, type } = definition;
    const val = line.substr(start, length);
    let output;
    switch (type) {
      case _TLE_DATA_TYPES._INT:
        output = parseInt(val, 10);
        break;
      case _TLE_DATA_TYPES._FLOAT:
        output = parseFloat(val);
        break;
      case _TLE_DATA_TYPES._DECIMAL_ASSUMED:
        output = parseFloat(`0.${val}`);
        break;
      case _TLE_DATA_TYPES._DECIMAL_ASSUMED_E:
        output = _decimalAssumedEToFloat(val);
        break;
      case _TLE_DATA_TYPES._CHAR:
      default:
        output = val.trim();
        break;
    }
    return output;
  }
  var _getObjLength = (obj) => Object.keys(obj).length;

  // ../tle/package/src/parsing.js
  var _ERRORS = {
    _TYPE: (context = "", expected = [], got = "") => `${context} must be of type [${expected.join(", ")}], but got ${got}.`,
    _NOT_PARSED_OBJECT: `Input object is malformed (should have name and tle properties).`
  };
  function isTLEObj(obj) {
    return typeof obj === _DATA_TYPES._OBJECT && obj.tle && getType(obj.tle) === _DATA_TYPES._ARRAY && obj.tle.length === 2;
  }
  var getTLECacheKey = (type, sourceTLE) => {
    if (type === _DATA_TYPES._ARRAY) {
      return sourceTLE.length === 3 ? sourceTLE[1] : sourceTLE[0];
    }
    return sourceTLE;
  };
  var tleCache = {};
  var clearTLEParseCache = () => tleCache = {};
  var acceptedTLETypes = [_DATA_TYPES._ARRAY, _DATA_TYPES._STRING, _DATA_TYPES._OBJECT];
  function parseTLE(sourceTLE, fastParse = true) {
    const type = getType(sourceTLE);
    const output = {};
    let tleArray = [];
    const alreadyParsed = isTLEObj(sourceTLE);
    if (alreadyParsed) {
      return sourceTLE;
    }
    const isUnexpectedObject = !alreadyParsed && type === _DATA_TYPES._OBJECT;
    if (isUnexpectedObject) {
      throw new Error(_ERRORS._NOT_PARSED_OBJECT);
    }
    const cacheKey = getTLECacheKey(type, sourceTLE);
    if (tleCache[cacheKey]) {
      return tleCache[cacheKey];
    }
    if (!acceptedTLETypes.includes(type)) {
      throw new Error(_ERRORS._TYPE("Source TLE", acceptedTLETypes, type));
    }
    if (type === _DATA_TYPES._STRING) {
      tleArray = sourceTLE.split("\n");
    } else if (type === _DATA_TYPES._ARRAY) {
      tleArray = Array.from(sourceTLE);
    }
    if (tleArray.length === 3) {
      let name = tleArray[0].trim();
      tleArray = tleArray.slice(1);
      if (name.startsWith("0 ")) {
        name = name.substr(2);
      }
      output.name = name;
    }
    output.tle = tleArray.map((line) => line.trim());
    if (!fastParse) {
      const isValid = isValidTLE(output.tle);
      if (!isValid) {
        output.error = "TLE parse error: bad TLE";
      }
    }
    tleCache[cacheKey] = output;
    return output;
  }
  function computeChecksum(tleLineStr) {
    const charArr = tleLineStr.split("");
    charArr.splice(charArr.length - 1, 1);
    if (charArr.length === 0) {
      throw new Error("Character array empty!", tleLineStr);
    }
    const checksum = charArr.reduce((sum, val) => {
      const parsedVal = parseInt(val, 10);
      const parsedSum = parseInt(sum, 10);
      if (Number.isInteger(parsedVal)) {
        return parsedSum + parsedVal;
      }
      if (val === "-") {
        return parsedSum + 1;
      }
      return parsedSum;
    }, 0);
    return checksum % 10;
  }
  function lineNumberIsValid(tleObj, lineNumber) {
    const { tle } = tleObj;
    return lineNumber === parseInt(tle[lineNumber - 1][0], 10);
  }
  function checksumIsValid(tleObj, lineNumber) {
    const { tle } = tleObj;
    const tleLine = tle[lineNumber - 1];
    const checksumInTLE = parseInt(tleLine[tleLine.length - 1], 10);
    const computedChecksum = computeChecksum(tle[lineNumber - 1]);
    return computedChecksum === checksumInTLE;
  }
  function isValidTLE(rawTLE) {
    let tleObj;
    try {
      tleObj = parseTLE(rawTLE);
    } catch (_e) {
      return false;
    }
    const line1NumberIsValid = lineNumberIsValid(tleObj, 1);
    const line2NumberIsValid = lineNumberIsValid(tleObj, 2);
    if (!line1NumberIsValid || !line2NumberIsValid) {
      return false;
    }
    const line1ChecksumIsValid = checksumIsValid(tleObj, 1);
    const line2ChecksumIsValid = checksumIsValid(tleObj, 2);
    if (!line1ChecksumIsValid || !line2ChecksumIsValid) {
      return false;
    }
    return true;
  }

  // ../tle/package/src/line-1-definitions.js
  var lineNumber1 = {
    start: 0,
    length: 1,
    type: _TLE_DATA_TYPES._INT
  };
  var catalogNumber1 = {
    start: 2,
    length: 5,
    type: _TLE_DATA_TYPES._INT
  };
  var classification = {
    start: 7,
    length: 1,
    type: _TLE_DATA_TYPES._CHAR
  };
  var intDesignatorYear = {
    start: 9,
    length: 2,
    type: _TLE_DATA_TYPES._INT
  };
  var intDesignatorLaunchNumber = {
    start: 11,
    length: 3,
    type: _TLE_DATA_TYPES._INT
  };
  var intDesignatorPieceOfLaunch = {
    start: 14,
    length: 3,
    type: _TLE_DATA_TYPES._CHAR
  };
  var epochYear = {
    start: 18,
    length: 2,
    type: _TLE_DATA_TYPES._INT
  };
  var epochDay = {
    start: 20,
    length: 12,
    type: _TLE_DATA_TYPES._FLOAT
  };
  var firstTimeDerivative = {
    start: 33,
    length: 11,
    type: _TLE_DATA_TYPES._FLOAT
  };
  var secondTimeDerivative = {
    start: 44,
    length: 8,
    type: _TLE_DATA_TYPES._DECIMAL_ASSUMED_E
  };
  var bstarDrag = {
    start: 53,
    length: 8,
    type: _TLE_DATA_TYPES._DECIMAL_ASSUMED_E
  };
  var orbitModel = {
    start: 62,
    length: 1,
    type: _TLE_DATA_TYPES._INT
  };
  var tleSetNumber = {
    start: 64,
    length: 4,
    type: _TLE_DATA_TYPES._INT
  };
  var checksum1 = {
    start: 68,
    length: 1,
    type: _TLE_DATA_TYPES._INT
  };

  // ../tle/package/src/line-1-getters.js
  function getFromLine1(tle, definition, isTLEParsed = false) {
    const parsedTLE = isTLEParsed ? tle : parseTLE(tle);
    return getFromTLE(parsedTLE, 1, definition);
  }
  function getLineNumber1(tle, isTLEParsed) {
    return getFromLine1(tle, lineNumber1, isTLEParsed);
  }
  function getCatalogNumber1(tle, isTLEParsed) {
    return getFromLine1(tle, catalogNumber1, isTLEParsed);
  }
  function getClassification(tle, isTLEParsed) {
    return getFromLine1(tle, classification, isTLEParsed);
  }
  function getIntDesignatorYear(tle, isTLEParsed) {
    return getFromLine1(tle, intDesignatorYear, isTLEParsed);
  }
  function getIntDesignatorLaunchNumber(tle, isTLEParsed) {
    return getFromLine1(tle, intDesignatorLaunchNumber, isTLEParsed);
  }
  function getIntDesignatorPieceOfLaunch(tle, isTLEParsed) {
    return getFromLine1(tle, intDesignatorPieceOfLaunch, isTLEParsed);
  }
  function getEpochYear(tle, isTLEParsed) {
    return getFromLine1(tle, epochYear, isTLEParsed);
  }
  function getEpochDay(tle, isTLEParsed) {
    return getFromLine1(tle, epochDay, isTLEParsed);
  }
  function getFirstTimeDerivative(tle, isTLEParsed) {
    return getFromLine1(tle, firstTimeDerivative, isTLEParsed);
  }
  function getSecondTimeDerivative(tle, isTLEParsed) {
    return getFromLine1(tle, secondTimeDerivative, isTLEParsed);
  }
  function getBstarDrag(tle, isTLEParsed) {
    return getFromLine1(tle, bstarDrag, isTLEParsed);
  }
  function getOrbitModel(tle, isTLEParsed) {
    return getFromLine1(tle, orbitModel, isTLEParsed);
  }
  function getTleSetNumber(tle, isTLEParsed) {
    return getFromLine1(tle, tleSetNumber, isTLEParsed);
  }
  function getChecksum1(tle, isTLEParsed) {
    return getFromLine1(tle, checksum1, isTLEParsed);
  }

  // ../tle/package/src/line-2-definitions.js
  var lineNumber2 = {
    start: 0,
    length: 1,
    type: _TLE_DATA_TYPES._INT
  };
  var catalogNumber2 = {
    start: 2,
    length: 5,
    type: _TLE_DATA_TYPES._INT
  };
  var inclination = {
    start: 8,
    length: 8,
    type: _TLE_DATA_TYPES._FLOAT
  };
  var rightAscension = {
    start: 17,
    length: 8,
    type: _TLE_DATA_TYPES._FLOAT
  };
  var eccentricity = {
    start: 26,
    length: 7,
    type: _TLE_DATA_TYPES._DECIMAL_ASSUMED
  };
  var perigee = {
    start: 34,
    length: 8,
    type: _TLE_DATA_TYPES._FLOAT
  };
  var meanAnomaly = {
    start: 43,
    length: 8,
    type: _TLE_DATA_TYPES._FLOAT
  };
  var meanMotion = {
    start: 52,
    length: 11,
    type: _TLE_DATA_TYPES._FLOAT
  };
  var revNumberAtEpoch = {
    start: 63,
    length: 5,
    type: _TLE_DATA_TYPES._INT
  };
  var checksum2 = {
    start: 68,
    length: 1,
    type: _TLE_DATA_TYPES._INT
  };

  // ../tle/package/src/line-2-getters.js
  function getFromLine2(tle, definition, isTLEParsed = false) {
    const parsedTLE = isTLEParsed ? tle : parseTLE(tle);
    return getFromTLE(parsedTLE, 2, definition);
  }
  function getLineNumber2(tle, isTLEParsed) {
    return getFromLine2(tle, lineNumber2, isTLEParsed);
  }
  function getCatalogNumber2(tle, isTLEParsed) {
    return getFromLine2(tle, catalogNumber2, isTLEParsed);
  }
  function getInclination(tle, isTLEParsed) {
    return getFromLine2(tle, inclination, isTLEParsed);
  }
  function getRightAscension(tle, isTLEParsed) {
    return getFromLine2(tle, rightAscension, isTLEParsed);
  }
  function getEccentricity(tle, isTLEParsed) {
    return getFromLine2(tle, eccentricity, isTLEParsed);
  }
  function getPerigee(tle, isTLEParsed) {
    return getFromLine2(tle, perigee, isTLEParsed);
  }
  function getMeanAnomaly(tle, isTLEParsed) {
    return getFromLine2(tle, meanAnomaly, isTLEParsed);
  }
  function getMeanMotion(tle, isTLEParsed) {
    return getFromLine2(tle, meanMotion, isTLEParsed);
  }
  function getRevNumberAtEpoch(tle, isTLEParsed) {
    return getFromLine2(tle, revNumberAtEpoch, isTLEParsed);
  }
  function getChecksum2(tle, isTLEParsed) {
    return getFromLine2(tle, checksum2, isTLEParsed);
  }

  // ../tle/package/src/sugar-getters.js
  function getCOSPAR(tle, tleIsParsed) {
    const partialYear = getIntDesignatorYear(tle, tleIsParsed);
    const fullYear = _getFullYear(partialYear);
    const launchNum = getIntDesignatorLaunchNumber(tle, tleIsParsed);
    const launchNumWithPadding = launchNum.toString().padStart(3, 0);
    const launchPiece = getIntDesignatorPieceOfLaunch(tle, tleIsParsed);
    return `${fullYear}-${launchNumWithPadding}${launchPiece}`;
  }
  function getSatelliteName(rawTLE, fallbackToCOSPAR = false) {
    const parsedTLE = parseTLE(rawTLE);
    const { name } = parsedTLE;
    if (fallbackToCOSPAR) {
      return name || getCOSPAR(parsedTLE, true);
    } else {
      return name || "Unknown";
    }
  }
  function getEpochTimestamp(rawTLE) {
    const epochDay2 = getEpochDay(rawTLE);
    const epochYear2 = getEpochYear(rawTLE);
    return _dayOfYearToTimeStamp(epochDay2, epochYear2);
  }
  function getAverageOrbitTimeMS(tle) {
    return parseInt(_MS_IN_A_DAY / getMeanMotion(tle), 10);
  }
  function getAverageOrbitTimeMins(tle) {
    return getAverageOrbitTimeMS(tle) / _MS_IN_A_MINUTE;
  }
  function getAverageOrbitTimeS(tle) {
    return getAverageOrbitTimeMS(tle) / _MS_IN_A_SECOND;
  }

  // ../tle/package/src/sgp4.js
  var _SAT_REC_ERRORS = {
    _DEFAULT: "Problematic TLE with unknown error.",
    1: "Mean elements, ecc >= 1.0 or ecc < -0.001 or a < 0.95 er",
    2: "Mean motion less than 0.0",
    3: "Pert elements, ecc < 0.0  or  ecc > 1.0",
    4: "Semi-latus rectum < 0.0",
    5: "Epoch elements are sub-orbital",
    6: "Satellite has decayed"
  };
  var cachedSatelliteInfo = {};
  var cachedAntemeridianCrossings = {};
  var cachedOrbitTracks = {};
  var cachedGroundTrack = {};
  var caches = [cachedSatelliteInfo, cachedAntemeridianCrossings, cachedOrbitTracks, cachedGroundTrack];
  function getCacheSizes() {
    return caches.map(_getObjLength);
  }
  function clearCache() {
    caches.forEach((_cache) => {
      Object.keys(_cache).forEach((key) => delete _cache[key]);
    });
  }
  function getSatelliteInfo(rawTLE, rawTimestamp, observerLat, observerLng, observerHeight) {
    const timestamp = rawTimestamp || Date.now();
    const { tle, error: parseError } = parseTLE(rawTLE);
    if (parseError) {
      throw new Error(parseError);
    }
    const defaultObserverPosition = {
      lat: 36.9613422,
      lng: -122.0308,
      height: 0.37
    };
    const obsLat = observerLat || defaultObserverPosition.lat;
    const obsLng = observerLng || defaultObserverPosition.lng;
    const obsHeight = observerHeight || defaultObserverPosition.height;
    const cacheKey = `${tle[0]}-${timestamp}-${observerLat}-${observerLng}
-${observerHeight}`;
    if (cachedSatelliteInfo[cacheKey]) {
      return cachedSatelliteInfo[cacheKey];
    }
    const satrec = twoline2satrec(tle[0], tle[1]);
    if (satrec.error) {
      throw new Error(_SAT_REC_ERRORS[satrec.error] || _SAT_REC_ERRORS._DEFAULT);
    }
    const dateObj = new Date(timestamp);
    const positionAndVelocity = propagate(satrec, dateObj);
    const positionEci = positionAndVelocity.position;
    const velocityEci = positionAndVelocity.velocity;
    const observerGd = {
      latitude: _degreesToRadians(obsLat),
      longitude: _degreesToRadians(obsLng),
      height: obsHeight
    };
    const gmst = gstime(dateObj);
    const positionEcf = eciToEcf(positionEci, gmst);
    const positionGd = eciToGeodetic(positionEci, gmst);
    const lookAngles = ecfToLookAngles(observerGd, positionEcf);
    const velocityKmS = Math.sqrt(Math.pow(velocityEci.x, 2) + Math.pow(velocityEci.y, 2) + Math.pow(velocityEci.z, 2));
    const { azimuth, elevation, rangeSat } = lookAngles;
    const { longitude, latitude, height } = positionGd;
    const output = {
      lng: degreesLong(longitude),
      lat: degreesLat(latitude),
      elevation: _radiansToDegrees(elevation),
      azimuth: _radiansToDegrees(azimuth),
      range: rangeSat,
      height,
      velocity: velocityKmS
    };
    cachedSatelliteInfo[cacheKey] = output;
    return output;
  }
  function getCachedLastAntemeridianCrossingTimeMS(tleObj, timeMS) {
    const { tle } = tleObj;
    const orbitLengthMS = getAverageOrbitTimeMins(tle) * 60 * 1e3;
    const tleStr = tle[0].substr(0, 30);
    const cachedCrossingTimes = cachedAntemeridianCrossings[tleStr];
    if (!cachedCrossingTimes) return false;
    if (cachedCrossingTimes === -1) return cachedCrossingTimes;
    const cachedTime = cachedCrossingTimes.filter((val) => {
      if (typeof val === "object" && val.tle === tle) return -1;
      const diff = timeMS - val;
      const isDiffPositive = diff > 0;
      const isWithinOrbit = isDiffPositive && diff < orbitLengthMS;
      return isWithinOrbit;
    });
    return cachedTime[0] || false;
  }
  function getLastAntemeridianCrossingTimeMS(tle, timeMS) {
    const parsedTLE = parseTLE(tle);
    const { tle: tleArr } = parsedTLE;
    const cachedVal = getCachedLastAntemeridianCrossingTimeMS(parsedTLE, timeMS);
    if (cachedVal) {
      return cachedVal;
    }
    const time = timeMS || Date.now();
    let step = 1e3 * 60 * 3;
    let curLngLat = [];
    let lastLngLat = [];
    let curTimeMS = time;
    let didCrossAntemeridian = false;
    let tries = 0;
    let isDone = false;
    const maxTries = 1e3;
    while (!isDone) {
      curLngLat = getLngLat(tleArr, curTimeMS);
      const [curLng] = curLngLat;
      didCrossAntemeridian = _crossesAntemeridian(lastLngLat[0], curLng);
      if (didCrossAntemeridian) {
        curTimeMS += step;
        step = step / 2;
      } else {
        curTimeMS -= step;
        lastLngLat = curLngLat;
      }
      isDone = step < 500 || tries >= maxTries;
      tries++;
    }
    const couldNotFindCrossing = tries - 1 === maxTries;
    const crossingTime = couldNotFindCrossing ? -1 : parseInt(curTimeMS, 10);
    const tleStr = tleArr[0];
    if (!cachedAntemeridianCrossings[tleStr]) {
      cachedAntemeridianCrossings[tleStr] = [];
    }
    if (couldNotFindCrossing) {
      cachedAntemeridianCrossings[tleStr] = -1;
    } else {
      cachedAntemeridianCrossings[tleStr].push(crossingTime);
    }
    return crossingTime;
  }
  function getLatLngObj(tle, optionalTimestamp = Date.now()) {
    const { lat, lng } = getSatelliteInfo(tle, optionalTimestamp);
    return { lat, lng };
  }
  function getLngLat(tle, optionalTimestamp = Date.now()) {
    const { lat, lng } = getSatelliteInfo(tle, optionalTimestamp);
    return [lng, lat];
  }
  function getLngLatAtEpoch(tle) {
    return getLngLat(tle, getEpochTimestamp(tle));
  }
  function getVisibleSatellites({
    observerLat,
    observerLng,
    observerHeight = 0,
    tles = [],
    elevationThreshold = 0,
    timestampMS = Date.now()
  }) {
    return tles.reduce((visibleSats, tleArr) => {
      let info;
      try {
        info = getSatelliteInfo(tleArr, timestampMS, observerLat, observerLng, observerHeight);
      } catch (_e) {
        return visibleSats;
      }
      const { elevation } = info;
      return elevation >= elevationThreshold ? visibleSats.concat({ tleArr, info }) : visibleSats;
    }, []);
  }
  function* getNextPosition(tleArr, startTimeMS, stepMS) {
    let curTimeMS = startTimeMS - stepMS;
    while (true) {
      curTimeMS += stepMS;
      yield {
        curTimeMS,
        lngLat: getLngLat(tleArr, curTimeMS)
      };
    }
  }
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  async function getOrbitTrack({
    tle,
    startTimeMS = Date.now(),
    stepMS = 1e3,
    sleepMS = 0,
    jobChunkSize = 1e3,
    maxTimeMS,
    isLngLatFormat = true
  }) {
    const { tle: tleArr } = parseTLE(tle);
    maxTimeMS ?? (maxTimeMS = getAverageOrbitTimeMS(tleArr) * 1.5);
    const startS = (startTimeMS / 1e3).toFixed();
    const cacheKey = `${tleArr[0]}-${startS}-${stepMS}-${isLngLatFormat}`;
    if (cachedOrbitTracks[cacheKey]) {
      return cachedOrbitTracks[cacheKey];
    }
    const generator = getNextPosition(tleArr, startTimeMS, stepMS, isLngLatFormat);
    let step = 0;
    let isDone = false;
    let coords = [];
    let lastLng;
    while (!isDone) {
      const { curTimeMS, lngLat } = generator.next().value;
      const [curLng, curLat] = lngLat;
      const doesCrossAntemeridian = _crossesAntemeridian(lastLng, curLng);
      const doesExceedTime = maxTimeMS && curTimeMS - startTimeMS > maxTimeMS;
      isDone = doesCrossAntemeridian || doesExceedTime;
      if (isDone) break;
      if (isLngLatFormat) {
        coords.push(lngLat);
      } else {
        coords.push([curLat, curLng]);
      }
      if (sleepMS && step % jobChunkSize === 0) {
        await sleep(sleepMS);
      }
      lastLng = curLng;
      step++;
    }
    cachedOrbitTracks[cacheKey] = coords;
    return coords;
  }
  function getOrbitTrackSync({
    tle,
    startTimeMS = Date.now(),
    stepMS = 1e3,
    maxTimeMS = 6e6,
    isLngLatFormat = true
  }) {
    const { tle: tleArr } = parseTLE(tle);
    const startS = (startTimeMS / 1e3).toFixed();
    const cacheKey = `${tleArr[0]}-${startS}-${stepMS}-${isLngLatFormat}`;
    if (cachedOrbitTracks[cacheKey]) {
      return cachedOrbitTracks[cacheKey];
    }
    let isDone = false;
    let coords = [];
    let lastLng;
    let curTimeMS = startTimeMS;
    while (!isDone) {
      const curLngLat = getLngLat(tleArr, curTimeMS);
      const [curLng, curLat] = curLngLat;
      const doesCrossAntemeridian = _crossesAntemeridian(lastLng, curLng);
      const doesExceedTime = maxTimeMS && curTimeMS - startTimeMS > maxTimeMS;
      isDone = doesCrossAntemeridian || doesExceedTime;
      if (isDone) break;
      if (isLngLatFormat) {
        coords.push(curLngLat);
      } else {
        coords.push([curLat, curLng]);
      }
      lastLng = curLng;
      curTimeMS += stepMS;
    }
    cachedOrbitTracks[cacheKey] = coords;
    return coords;
  }
  function getGroundTracks({ tle, startTimeMS = Date.now(), stepMS = 1e3, isLngLatFormat = true }) {
    const parsedTLE = parseTLE(tle);
    const orbitTimeMS = getAverageOrbitTimeMS(parsedTLE);
    const curOrbitStartMS = getLastAntemeridianCrossingTimeMS(parsedTLE, startTimeMS);
    const foundCrossing = curOrbitStartMS !== -1;
    if (!foundCrossing) {
      return Promise.all([
        getOrbitTrack({
          tle: parsedTLE,
          startTimeMS,
          stepMS: _MS_IN_A_MINUTE,
          maxTimeMS: _MS_IN_A_DAY / 4,
          isLngLatFormat
        })
      ]);
    }
    const bufferMS = orbitTimeMS / 5;
    const lastOrbitStartMS = getLastAntemeridianCrossingTimeMS(parsedTLE, curOrbitStartMS - bufferMS);
    const nextOrbitStartMS = getLastAntemeridianCrossingTimeMS(parsedTLE, curOrbitStartMS + orbitTimeMS + bufferMS);
    const groundTrackPromises = [
      getOrbitTrack({
        tle: parsedTLE,
        startTimeMS: lastOrbitStartMS,
        stepMS,
        isLngLatFormat
      }),
      getOrbitTrack({
        tle: parsedTLE,
        startTimeMS: curOrbitStartMS,
        stepMS,
        isLngLatFormat
      }),
      getOrbitTrack({
        tle: parsedTLE,
        startTimeMS: nextOrbitStartMS,
        stepMS,
        isLngLatFormat
      })
    ];
    return Promise.all(groundTrackPromises);
  }
  function getGroundTracksSync({ tle, stepMS = 1e3, startTimeMS = Date.now(), isLngLatFormat = true }) {
    const parsedTLE = parseTLE(tle);
    const { tle: tleArr } = parsedTLE;
    const orbitTimeMS = getAverageOrbitTimeMS(tleArr);
    const curOrbitStartMS = getLastAntemeridianCrossingTimeMS(parsedTLE, startTimeMS);
    const foundCrossing = curOrbitStartMS !== -1;
    if (!foundCrossing) {
      const partialGroundTrack = getOrbitTrackSync({
        tle: parsedTLE,
        startTimeMS,
        stepMS: _MS_IN_A_MINUTE,
        maxTimeMS: _MS_IN_A_DAY / 4
      });
      return partialGroundTrack;
    }
    const bufferMS = orbitTimeMS / 5;
    const lastOrbitStartMS = getLastAntemeridianCrossingTimeMS(parsedTLE, curOrbitStartMS - bufferMS);
    const nextOrbitStartMS = getLastAntemeridianCrossingTimeMS(parsedTLE, curOrbitStartMS + orbitTimeMS + bufferMS);
    const orbitStartTimes = [lastOrbitStartMS, curOrbitStartMS, nextOrbitStartMS];
    const orbitLatLons = orbitStartTimes.map((orbitStartMS) => {
      return getOrbitTrackSync({
        tle: parsedTLE,
        startTimeMS: orbitStartMS,
        stepMS,
        isLngLatFormat
      });
    });
    return orbitLatLons;
  }
  function getSatBearing(tle, timeMS = Date.now()) {
    const parsedTLE = this.parseTLE(tle);
    const latLon1 = this.getLatLonArr(parsedTLE.arr, timeMS);
    const latLon2 = this.getLatLonArr(parsedTLE.arr, timeMS + 1e4);
    const doesCrossAntemeridian = _crossesAntemeridian(latLon1[1], latLon2[1]);
    if (doesCrossAntemeridian) {
      return {};
    }
    const lat1 = _degreesToRadians(latLon1[0]);
    const lat2 = _degreesToRadians(latLon2[0]);
    const lon1 = _degreesToRadians(latLon1[1]);
    const lon2 = _degreesToRadians(latLon2[1]);
    const NS = lat1 >= lat2 ? "S" : "N";
    const EW = lon1 >= lon2 ? "W" : "E";
    const y = Math.sin(lon2 - lon1) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);
    const degrees = _radiansToDegrees(Math.atan2(y, x));
    return {
      degrees,
      compass: `${NS}${EW}`
    };
  }
  return __toCommonJS(index_exports);
})();
