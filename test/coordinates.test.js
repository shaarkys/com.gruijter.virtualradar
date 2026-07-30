/* eslint-disable no-console */
"use strict";

const assert = require("assert");
const { getRadarCoordinates } = require("../lib/coordinates");
const OpenSkyRadar = require("../radar_opensky");
const LocalFeederRadar = require("../radar_local_feeder");
const AdsbExchangePaidRadar = require("../radar_adsbexchange_paid");

function testCoordinateValidation() {
  assert.deepStrictEqual(
    getRadarCoordinates({ lat: "49.2952747", lon: "16.5065583" }),
    { lat: 49.2952747, lon: 16.5065583, usesLegacyLongitude: false }
  );
  assert.deepStrictEqual(
    getRadarCoordinates({ lat: 49.2952747, lng: 16.5065583 }),
    { lat: 49.2952747, lon: 16.5065583, usesLegacyLongitude: true }
  );
  assert.deepStrictEqual(
    getRadarCoordinates({ lat: -90, lon: 180 }),
    { lat: -90, lon: 180, usesLegacyLongitude: false }
  );

  assert.throws(() => getRadarCoordinates({ lat: 90.0001, lon: 0 }), /Latitude.*-90.*90/);
  assert.throws(() => getRadarCoordinates({ lat: -90.0001, lon: 0 }), /Latitude.*-90.*90/);
  assert.throws(() => getRadarCoordinates({ lat: 0, lon: 180.0001 }), /Longitude.*-180.*180/);
  assert.throws(() => getRadarCoordinates({ lat: 0, lon: -180.0001 }), /Longitude.*-180.*180/);
  assert.throws(() => getRadarCoordinates({ lat: "", lon: 0 }), /Latitude/);
  assert.throws(() => getRadarCoordinates({ lat: 0, lon: "not-a-coordinate" }), /Longitude/);
}

function testRadarConstructorsRejectInvalidCoordinates() {
  const commonSettings = {
    lat: 91,
    lon: 16.5065583,
    dst: 5,
    authMethod: "none",
    localFeederUrl: "192.168.1.10",
  };

  [OpenSkyRadar, LocalFeederRadar, AdsbExchangePaidRadar].forEach((Radar) => {
    assert.throws(() => new Radar(commonSettings), /Latitude.*-90.*90/);
  });
}

testCoordinateValidation();
testRadarConstructorsRejectInvalidCoordinates();
console.log("coordinate validation tests passed");
