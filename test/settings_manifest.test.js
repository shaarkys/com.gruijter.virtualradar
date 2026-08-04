/* eslint-disable no-console */
"use strict";

const assert = require("assert");
const path = require("path");

const driverManifests = ["radar", "tracker"];
const coordinateRanges = {
  lat: { min: -90, max: 90 },
  lon: { min: -180, max: 180 },
};

function findSetting(settings, id) {
  for (const setting of settings) {
    if (setting.id === id) return setting;
    if (Array.isArray(setting.children)) {
      const child = findSetting(setting.children, id);
      if (child) return child;
    }
  }
  return undefined;
}

for (const driverId of driverManifests) {
  const manifestPath = path.join(__dirname, "..", "drivers", driverId, "driver.compose.json");
  const manifest = require(manifestPath);

  for (const [id, range] of Object.entries(coordinateRanges)) {
    const setting = findSetting(manifest.settings, id);
    assert(setting, `${driverId} manifest must define ${id}`);
    assert.strictEqual(setting.type, "number", `${driverId}.${id} must be a number setting`);
    assert.strictEqual(setting.min, range.min, `${driverId}.${id} must preserve its minimum`);
    assert.strictEqual(setting.max, range.max, `${driverId}.${id} must preserve its maximum`);
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(setting, "step"),
      false,
      `${driverId}.${id} must not define a manifest step`
    );
  }
}

console.log("settings manifest coordinate tests passed");
