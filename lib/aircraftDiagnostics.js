"use strict";

function isMissing(value) {
  return value === undefined
    || value === null
    || String(value).trim() === ""
    || ["-", "N/A"].includes(String(value).trim().toUpperCase());
}

function cleanLogValue(value) {
  if (isMissing(value)) return "-";
  return String(value)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[;]+/g, ",")
    .trim();
}

function formatNumber(value, decimals = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(decimals) : "-";
}

function formatMetadataSources(ac) {
  const sources = ac.metadataSources || {};
  const fields = [
    ["registration", sources.registration],
    ["model", sources.model],
    ["icaoType", sources.icaoType],
    ["operator", sources.operator],
  ]
    .filter(([, source]) => !isMissing(source))
    .map(([field, source]) => `${field}:${cleanLogValue(source)}`);

  return fields.length ? fields.join(",") : cleanLogValue(ac.metadataSource);
}

function formatAircraftDiagnostic(event, ac, feed, extra = {}) {
  const aircraft = ac || {};
  const missing = [
    ["callsign", aircraft.call],
    ["registration", aircraft.reg],
    ["icaoType", aircraft.type],
    ["model", aircraft.mdl],
    ["operator", aircraft.op],
  ]
    .filter(([, value]) => isMissing(value))
    .map(([field]) => field);

  const geometricAltitude = Number(aircraft.gAlt);
  const barometricAltitude = Number(aircraft.bAlt);
  const altitude = Number.isFinite(geometricAltitude) && geometricAltitude !== 0
    ? geometricAltitude
    : barometricAltitude;
  const fields = [
    `[aircraft] event=${cleanLogValue(event)}`,
    `feed=${cleanLogValue(feed)}`,
    `stateSource=${cleanLogValue(aircraft.stateSource || feed)}`,
    `positionSource=${cleanLogValue(aircraft.positionSource || aircraft.stateSource || feed)}`,
    `receivers=${cleanLogValue(aircraft.sensors)}`,
    `metadataSources=${formatMetadataSources(aircraft)}`,
    `icao=${cleanLogValue(aircraft.icao)}`,
    `call=${cleanLogValue(aircraft.call)}`,
    `reg=${cleanLogValue(aircraft.reg)}`,
    `icaoType=${cleanLogValue(aircraft.type)}`,
    `model=${cleanLogValue(aircraft.mdl)}`,
    `operator=${cleanLogValue(aircraft.op)}`,
    `country=${cleanLogValue(aircraft.oc)}`,
    `lat=${formatNumber(aircraft.lat, 5)}`,
    `lon=${formatNumber(aircraft.lon, 5)}`,
    `altitudeM=${formatNumber(altitude)}`,
    `speedKmh=${formatNumber(aircraft.spd)}`,
    `distanceKm=${formatNumber(Number(aircraft.dst) / 1000, 1)}`,
    `ground=${Boolean(aircraft.gnd)}`,
    `squawk=${cleanLogValue(aircraft.sqk)}`,
    `trackedSeconds=${formatNumber(extra.trackedSeconds)}`,
    `missing=${missing.length ? missing.join(",") : "none"}`,
  ];

  if (!isMissing(aircraft.dataEndpoint)) {
    fields.splice(4, 0, `endpoint=${cleanLogValue(aircraft.dataEndpoint)}`);
  }

  return fields.join("; ");
}

module.exports = {
  formatAircraftDiagnostic,
  isMissing,
};
