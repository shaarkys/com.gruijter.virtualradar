/* eslint-disable no-console */
"use strict";

const assert = require("assert");
const LocalFeederRadar = require("../radar_local_feeder");

const settings = {
  lat: 49.2952747,
  lon: 16.5065583,
  dst: 10,
  localFeederUrl: "192.168.1.10:8080",
  localFeederUnits: "aviation",
};

function testCandidateUrls() {
  const candidates = LocalFeederRadar.getCandidateUrls("192.168.1.10:8080");
  assert.strictEqual(candidates[0], "http://192.168.1.10:8080/data/aircraft.json");
  assert(candidates.includes("http://192.168.1.10:8080/dump1090-fa/data/aircraft.json"));
  assert(candidates.includes("http://192.168.1.10:8080/skyaware/data/aircraft.json"));
  assert(candidates.includes("http://192.168.1.10:8080/tar1090/data/aircraft.json"));
  assert(candidates.includes("http://192.168.1.10:8080/VirtualRadar/AircraftList.json"));

  const nested = LocalFeederRadar.getCandidateUrls("http://feeder.local/tar1090/");
  assert.strictEqual(nested[0], "http://feeder.local/tar1090/data/aircraft.json");

  const explicit = LocalFeederRadar.getCandidateUrls("http://feeder.local/custom/aircraft.json?receiver=1");
  assert.deepStrictEqual(explicit, ["http://feeder.local/custom/aircraft.json?receiver=1"]);
  assert.throws(
    () => LocalFeederRadar.getCandidateUrls("ftp://feeder.local/aircraft.json"),
    /must use http/
  );
  assert.throws(
    () => LocalFeederRadar.getCandidateUrls("http://user:password@feeder.local/aircraft.json"),
    /embedded/
  );
}

async function testDump1090DiscoveryAndNormalization() {
  const radar = new LocalFeederRadar(settings);
  const requested = [];
  radar._requestJson = async (endpoint) => {
    requested.push(endpoint);
    if (!endpoint.includes("/dump1090-fa/")) {
      throw new Error("HTTP 404");
    }
    return {
      now: 1785145100,
      aircraft: [
        {
          hex: "503d79",
          flight: "AHY109  ",
          r: "LY-JAM",
          t: "A320",
          desc: "AIRBUS A-320",
          alt_baro: 25525,
          alt_geom: 26350,
          gs: 367.2,
          track: 296.01,
          baro_rate: -1408,
          squawk: "1000",
          lat: 49.284897,
          lon: 16.414208,
          seen: 0.3,
          dbFlags: 1,
        },
        {
          hex: "FFFFFF",
          lat: 50.5,
          lon: 18.5,
        },
        {
          hex: "AAAAAA",
          alt_baro: 10000,
        },
      ],
    };
  };

  const aircraft = await radar.getAcInRange();

  assert.strictEqual(aircraft.length, 1);
  assert.strictEqual(aircraft[0].icao, "503D79");
  assert.strictEqual(aircraft[0].call, "AHY109");
  assert.strictEqual(aircraft[0].reg, "LY-JAM");
  assert.strictEqual(aircraft[0].type, "A320");
  assert.strictEqual(aircraft[0].mdl, "AIRBUS A-320");
  assert.strictEqual(aircraft[0].bAlt, 7780);
  assert.strictEqual(aircraft[0].spd, 680);
  assert.strictEqual(aircraft[0].vsi, -7);
  assert.strictEqual(aircraft[0].mil, true);
  assert.strictEqual(aircraft[0].stateSource, "localFeeder");
  assert.strictEqual(aircraft[0].positionSource, "ADS-B/local feeder");
  assert.strictEqual(aircraft[0].metadataSource, "localFeeder");
  assert.deepStrictEqual(aircraft[0].metadataSources, {
    registration: "localFeeder",
    model: "localFeeder",
    icaoType: "localFeeder",
    operator: "",
  });
  assert.strictEqual(
    aircraft[0].dataEndpoint,
    "http://192.168.1.10:8080/dump1090-fa/data/aircraft.json"
  );
  assert(aircraft[0].dst < 10000);
  assert.strictEqual(radar.resolvedEndpoint, "http://192.168.1.10:8080/dump1090-fa/data/aircraft.json");
  assert.strictEqual(requested.length, 2);

  requested.length = 0;
  await radar.getAcInRange();
  assert.deepStrictEqual(requested, ["http://192.168.1.10:8080/dump1090-fa/data/aircraft.json"]);
}

async function testTrackerAndVirtualRadarServerFormat() {
  const radar = new LocalFeederRadar({
    ...settings,
    localFeederUrl: "http://feeder.local/VirtualRadar/AircraftList.json",
  });
  radar._requestJson = async () => ({
    stm: 1785145100000,
    acList: [
      {
        Icao: "503EB3",
        Call: "EWG8SP",
        Reg: "LY-CAP",
        Lat: 49.3,
        Long: 16.51,
        Alt: 33000,
        GAlt: 34075,
        Spd: 450,
        Trak: 132,
        Vsi: 0,
        Sqk: "7605",
        Mdl: "Airbus A320-214",
        Type: "A320",
        OpCode: "EWG",
      },
    ],
  });

  const byIcao = await radar.getAc({ ico: "503eb3", reg: "", call: "" });
  const byRegistration = await radar.getAc({ ico: "", reg: "ly-cap", call: "" });
  const byCallsign = await radar.getAc({ ico: "", reg: "", call: "ewg8sp" });

  assert.strictEqual(byIcao[0].type, "A320");
  assert.strictEqual(byIcao[0].mdl, "Airbus A320-214");
  assert.strictEqual(byRegistration[0].icao, "503EB3");
  assert.strictEqual(byCallsign[0].reg, "LY-CAP");
}

async function run() {
  testCandidateUrls();
  await testDump1090DiscoveryAndNormalization();
  await testTrackerAndVirtualRadarServerFormat();
  console.log("radar_local_feeder tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
