"use strict";

function hasCoordinateValue(value) {
  return value !== undefined && value !== null && !(typeof value === "string" && value.trim() === "");
}

function parseCoordinate(value, name, minimum, maximum) {
  if (!hasCoordinateValue(value) || !["number", "string"].includes(typeof value)) {
    throw new Error(`${name} must be a number between ${minimum} and ${maximum}.`);
  }

  const coordinate = Number(value);
  if (!Number.isFinite(coordinate) || coordinate < minimum || coordinate > maximum) {
    throw new Error(`${name} must be a number between ${minimum} and ${maximum}.`);
  }
  return coordinate;
}

function getRadarCoordinates(settings) {
  if (!settings || typeof settings !== "object") {
    throw new Error("Radar settings are missing.");
  }

  const usesLegacyLongitude = !hasCoordinateValue(settings.lon) && hasCoordinateValue(settings.lng);
  return {
    lat: parseCoordinate(settings.lat, "Latitude", -90, 90),
    lon: parseCoordinate(usesLegacyLongitude ? settings.lng : settings.lon, "Longitude", -180, 180),
    usesLegacyLongitude,
  };
}

module.exports = {
  getRadarCoordinates,
};
