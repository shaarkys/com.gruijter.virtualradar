/* eslint-disable no-console */
"use strict";

const assert = require("assert");
const VirtualRadar = require("../radar_opensky");
const { getCredentialDiagnostics } = require("../lib/credentialDiagnostics");
const { formatAircraftDiagnostic } = require("../lib/aircraftDiagnostics");

const settings = {
  lat: 49.2952747,
  lon: 16.5065583,
  dst: 5,
  authMethod: "none",
};

const state = [
  "48c22b",
  "RYR123  ",
  "Poland",
  1753606767,
  1753606767,
  16.51,
  49.3,
  8500,
  false,
  220,
  180,
  0,
  null,
  8600,
  "1234",
  false,
  0,
  4,
];

async function testMetadataMappingAndCache() {
  const radar = new VirtualRadar(settings);
  let requestCount = 0;
  radar._makeHttpsRequest = async (options) => {
    requestCount += 1;
    assert.strictEqual(options.hostname, "api.adsbdb.com");
    assert.strictEqual(options.path, "/v0/aircraft/48C22B");
    assert.strictEqual(options.skipAuth, true);
    return {
      statusCode: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        response: {
          aircraft: {
            type: "737NG 800/W",
            icao_type: "B738",
            registration: "SP-RSL",
            registered_owner_operator_flag_code: "RYS",
            registered_owner: "Buzz",
          },
        },
      }),
    };
  };

  const first = await radar._getMeta({ icao: "48C22B", op: "" });
  const second = await radar._getMeta({ icao: "48C22B", op: "" });

  assert.strictEqual(first.type, "B738");
  assert.strictEqual(first.mdl, "737NG 800/W");
  assert.strictEqual(first.reg, "SP-RSL");
  assert.strictEqual(first.op, "RYS");
  assert.deepStrictEqual(first.metadataSources, {
    model: "ADSBDB",
    icaoType: "ADSBDB",
    registration: "ADSBDB",
    operator: "ADSBDB",
  });
  assert.strictEqual(first.metadataSource, "ADSBDB");
  assert.strictEqual(second.type, "B738");
  assert.strictEqual(requestCount, 1);
}

async function testConcurrentMetadataRequestsAreDeduplicated() {
  const radar = new VirtualRadar(settings);
  let requestCount = 0;
  radar._makeHttpsRequest = async () => {
    requestCount += 1;
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        response: {
          aircraft: {
            type: "A320 251NSL",
            icao_type: "A20N",
            registration: "TC-NBI",
            registered_owner: "Pegasus Airlines",
          },
        },
      }),
    };
  };

  const aircraft = await Promise.all([
    radar._getMeta({ icao: "4BB849", op: "" }),
    radar._getMeta({ icao: "4BB849", op: "" }),
  ]);

  assert.strictEqual(aircraft[0].type, "A20N");
  assert.strictEqual(aircraft[1].type, "A20N");
  assert.strictEqual(requestCount, 1);
}

async function testMissingMetadataIsCached() {
  const radar = new VirtualRadar(settings);
  let requestCount = 0;
  radar._makeHttpsRequest = async () => {
    requestCount += 1;
    return {
      statusCode: 404,
      headers: { "content-type": "application/json" },
      body: "{}",
    };
  };

  const first = await radar._getMeta({ icao: "FFFFFF", op: "" });
  const second = await radar._getMeta({ icao: "FFFFFF", op: "" });

  assert.strictEqual(first.type, "N/A");
  assert.strictEqual(second.type, "N/A");
  assert.strictEqual(first.metadataSource, "ADSBDB+HexDB:no-result");
  assert.strictEqual(requestCount, 2);
}

async function testHexDbFallback() {
  const radar = new VirtualRadar(settings);
  const requestedHosts = [];
  radar._makeHttpsRequest = async (options) => {
    requestedHosts.push(options.hostname);
    if (options.hostname === "api.adsbdb.com") {
      return {
        statusCode: 404,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ response: "unknown aircraft" }),
      };
    }
    assert.strictEqual(options.hostname, "hexdb.io");
    assert.strictEqual(options.path, "/api/v1/aircraft/503D79");
    assert.strictEqual(options.skipAuth, true);
    return {
      statusCode: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        ModeS: "503D79",
        Registration: "LY-JAM",
        Manufacturer: "Airbus",
        ICAOTypeCode: "A320",
        Type: "A320 233",
        RegisteredOwners: "Azerbaijan Airlines",
        OperatorFlagCode: "AHY",
      }),
    };
  };

  const aircraft = await radar._getMeta({ icao: "503D79", op: "" });

  assert.strictEqual(aircraft.type, "A320");
  assert.strictEqual(aircraft.mdl, "A320 233");
  assert.strictEqual(aircraft.reg, "LY-JAM");
  assert.strictEqual(aircraft.op, "AHY");
  assert.deepStrictEqual(aircraft.metadataSources, {
    model: "HexDB",
    icaoType: "HexDB",
    registration: "HexDB",
    operator: "HexDB",
  });
  assert.strictEqual(aircraft.metadataSource, "HexDB");
  assert.deepStrictEqual(requestedHosts, ["api.adsbdb.com", "hexdb.io"]);
}

async function testMetadataSourceCombination() {
  const radar = new VirtualRadar(settings);
  radar._makeHttpsRequest = async (options) => {
    if (options.hostname === "api.adsbdb.com") {
      return {
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          response: {
            aircraft: {
              type: "Airbus A320-214",
              registration: "LY-CAP",
              registered_owner: "Heston Airlines",
            },
          },
        }),
      };
    }
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ICAOTypeCode: "A320",
        Type: "A320 214",
      }),
    };
  };

  const aircraft = await radar._getMeta({ icao: "503EB3", op: "" });

  assert.strictEqual(aircraft.type, "A320");
  assert.strictEqual(aircraft.mdl, "Airbus A320-214");
  assert.strictEqual(aircraft.reg, "LY-CAP");
  assert.deepStrictEqual(aircraft.metadataSources, {
    model: "ADSBDB",
    icaoType: "HexDB",
    registration: "ADSBDB",
    operator: "ADSBDB",
  });
  assert.strictEqual(aircraft.metadataSource, "ADSBDB+HexDB");
}

async function testRangeScanEnrichesAircraftOnce() {
  const radar = new VirtualRadar(settings);
  let metadataCount = 0;
  radar._makeRequest = async () => ({ states: [state] });
  radar._getMeta = async (aircraft) => {
    metadataCount += 1;
    aircraft.type = "B738";
    return aircraft;
  };

  const aircraft = await radar.getAcInRange();

  assert.strictEqual(aircraft.length, 1);
  assert.strictEqual(aircraft[0].type, "B738");
  assert.strictEqual(aircraft[0].stateSource, "OpenSky states API");
  assert.strictEqual(aircraft[0].positionSource, "ADS-B");
  assert.strictEqual(metadataCount, 1);
}

function testAircraftDiagnosticFormatting() {
  const diagnostic = formatAircraftDiagnostic("enter", {
    icao: "4BA94F",
    call: "THY6NJ",
    reg: "TC-JJO",
    type: "",
    mdl: "Airbus A321",
    op: "THY;\nTurkish Airlines",
    oc: "Turkey",
    lat: 49.3,
    lon: 16.51,
    bAlt: 8200,
    gAlt: 0,
    spd: 650,
    dst: 3450,
    gnd: false,
    sqk: "1000",
    stateSource: "OpenSky states API",
    positionSource: "MLAT",
    metadataSources: {
      registration: "ADSBDB",
      model: "ADSBDB",
      operator: "ADSBDB",
    },
  }, "openSky", { trackedSeconds: 12 });

  assert(diagnostic.includes("[aircraft] event=enter"));
  assert(diagnostic.includes("feed=openSky"));
  assert(diagnostic.includes("positionSource=MLAT"));
  assert(diagnostic.includes("metadataSources=registration:ADSBDB,model:ADSBDB,operator:ADSBDB"));
  assert(diagnostic.includes("altitudeM=8200"));
  assert(diagnostic.includes("trackedSeconds=12"));
  assert(diagnostic.includes("missing=icaoType"));
  assert(!diagnostic.includes("\n"));
  assert(!diagnostic.includes("THY;"));
}

async function testSafeCredentialDiagnostics() {
  const clientId = "client-identifier";
  const clientSecret = "zeta-client-secret";
  const username = "private-user";
  const password = "omega-password";
  const diagnostics = getCredentialDiagnostics({
    authMethod: "oauth2",
    clientId,
    clientSecret,
    username,
    password,
  });

  assert(diagnostics.includes("authMethod=oauth2"));
  assert(diagnostics.includes(`clientId=clie*** (${clientId.length} chars)`));
  assert(diagnostics.includes(`clientSecret=set (${clientSecret.length} chars)`));
  assert(diagnostics.includes(`username=priv*** (${username.length} chars)`));
  assert(diagnostics.includes(`password=set (${password.length} chars)`));
  assert(!diagnostics.includes(clientId));
  assert(!diagnostics.includes(clientSecret));
  assert(!diagnostics.includes(username));
  assert(!diagnostics.includes(password));
  assert(!diagnostics.includes(clientSecret.slice(0, 4)));
  assert(!diagnostics.includes(password.slice(0, 4)));

  const radar = new VirtualRadar({
    ...settings,
    authMethod: "basic",
    username,
    password,
  });
  const logOutput = [];
  const originalConsoleLog = console.log;
  console.log = (...args) => logOutput.push(args.join(" "));
  try {
    const authHeader = await radar._getAuthHeader();
    assert(authHeader.startsWith("Basic "));
  } finally {
    console.log = originalConsoleLog;
  }

  const combinedOutput = logOutput.join("\n");
  assert(!combinedOutput.includes(username));
  assert(!combinedOutput.includes(password));
  assert(combinedOutput.includes(`username=priv*** (${username.length} chars)`));
  assert(combinedOutput.includes(`password=set (${password.length} chars)`));
}

async function run() {
  await testMetadataMappingAndCache();
  await testConcurrentMetadataRequestsAreDeduplicated();
  await testMissingMetadataIsCached();
  await testHexDbFallback();
  await testMetadataSourceCombination();
  await testRangeScanEnrichesAircraftOnce();
  testAircraftDiagnosticFormatting();
  await testSafeCredentialDiagnostics();
  console.log("radar_opensky tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
