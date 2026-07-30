/* eslint-disable no-console */
"use strict";

const assert = require("assert");
const Module = require("module");

const originalLoad = Module._load;
class MockHomeyDevice {}

Module._load = function loadWithHomeyMock(request, parent, isMain) {
  if (request === "homey") return { Device: MockHomeyDevice };
  return originalLoad.call(this, request, parent, isMain);
};

const RadarDevice = require("../drivers/radar/device");
const TrackerDevice = require("../drivers/tracker/device");
Module._load = originalLoad;

const validSettings = {
  service: "openSky",
  authMethod: "none",
  lat: 49.2952747,
  lon: 16.5065583,
  dst: 5,
  pollingInterval: 30,
};

function createDevice(DeviceClass, settings) {
  const device = new DeviceClass();
  device.log = () => {};
  device.error = () => {};
  device.getClass = () => "sensor";
  device.getName = () => "Test device";
  device.getSettings = () => ({ ...settings });
  device.hasCapability = (capability) => capability !== "ac_number";
  device.setAvailable = async () => {};
  device.setUnavailable = async (message) => {
    device.unavailableMessage = message;
  };
  return device;
}

async function testInvalidStoredCoordinatesDoNotEscapeOnInit() {
  for (const DeviceClass of [RadarDevice, TrackerDevice]) {
    const device = createDevice(DeviceClass, { ...validSettings, lat: 91 });
    await device.onInit();
    assert.match(device.unavailableMessage, /Latitude.*-90.*90/);
    assert.strictEqual(device.radar, undefined);
  }
}

async function testSettingsValidationAndGuardedReinitialization() {
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  let scheduledCallback;
  global.setTimeout = (callback) => {
    scheduledCallback = callback;
    return 1;
  };
  global.clearTimeout = () => {};

  try {
    for (const DeviceClass of [RadarDevice, TrackerDevice]) {
      const device = createDevice(DeviceClass, validSettings);
      scheduledCallback = undefined;

      await assert.rejects(
        device.onSettings({
          oldSettings: validSettings,
          newSettings: { ...validSettings, lat: -91 },
          changedKeys: ["lat"],
        }),
        /Latitude.*-90.*90/
      );
      assert.strictEqual(scheduledCallback, undefined);

      await device.onSettings({
        oldSettings: validSettings,
        newSettings: validSettings,
        changedKeys: ["lat"],
      });
      assert.strictEqual(typeof scheduledCallback, "function");

      device.onInit = async () => {
        throw new Error("forced reinitialization failure");
      };
      scheduledCallback();
      await new Promise((resolve) => setImmediate(resolve));
      assert.strictEqual(device.unavailableMessage, "forced reinitialization failure");
    }
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
}

async function run() {
  await testInvalidStoredCoordinatesDoNotEscapeOnInit();
  await testSettingsValidationAndGuardedReinitialization();
  console.log("device coordinate validation tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
