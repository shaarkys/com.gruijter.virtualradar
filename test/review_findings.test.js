/* eslint-disable no-console */
"use strict";

const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");

const originalLoad = Module._load;
class MockHomeyDevice {}

Module._load = function loadWithHomeyMock(request, parent, isMain) {
  if (request === "homey") return { Device: MockHomeyDevice };
  return originalLoad.call(this, request, parent, isMain);
};

let TrackerDevice;
try {
  TrackerDevice = require("../drivers/tracker/device");
} finally {
  Module._load = originalLoad;
}

async function testTrackerClearsDeclaredTimeCapability() {
  const device = new TrackerDevice();
  device.ac = { locString: "49.3, 16.5" };
  const calls = [];
  device.setCapability = (capability, value) => {
    calls.push({ capability, value });
  };

  await device.setAcCapabilities(null);

  assert.deepStrictEqual(
    calls.find(({ capability }) => capability === "ttime"),
    { capability: "ttime", value: "-" },
    "unavailable aircraft data must clear the declared ttime capability"
  );
  assert.strictEqual(
    calls.some(({ capability }) => capability === "tsecs"),
    false,
    "tsecs is a Flow token field, not a device capability"
  );
}

function testRadarPairDoesNotReadTrackerSelectors() {
  const radarPair = fs.readFileSync(
    path.join(__dirname, "..", "drivers", "radar", "pair", "pair.js"),
    "utf8"
  );
  const trackerPair = fs.readFileSync(
    path.join(__dirname, "..", "drivers", "tracker", "pair", "pair.js"),
    "utf8"
  );

  assert.strictEqual(radarPair.includes("trackIDSelection"), false);
  assert.strictEqual(radarPair.includes("trackID"), false);
  assert(trackerPair.includes("trackIDSelection"), "tracker pairing must retain track ID selection");
  assert(trackerPair.includes("trackID"), "tracker pairing must retain track ID input");
}

function testOperatorDescriptions() {
  const capability = require(path.join(__dirname, "..", ".homeycompose", "capabilities", "op.json"));
  assert.strictEqual(capability.desc.en, "Operator of the aircraft");
  assert.strictEqual(capability.desc.nl, "Operator van het vliegtuig");
}

async function run() {
  await testTrackerClearsDeclaredTimeCapability();
  testRadarPairDoesNotReadTrackerSelectors();
  testOperatorDescriptions();
  console.log("review findings tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
