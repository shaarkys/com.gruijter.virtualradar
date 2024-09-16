/*
Copyright 2018, 2019, Robin de Gruijter (gruijter@hotmail.com)

This file is part of com.gruijter.virtualradar.

com.gruijter.virtualradar is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

com.gruijter.virtualradar is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with com.gruijter.virtualradar.  If not, see <http://www.gnu.org/licenses/>.
*/

"use strict";

const Homey = require("homey");
const Radar = require("../../radar");
// const util = require('util');

function getTokens(ac) {
  if (!ac) return {};
  const tokens = {
    icao: ac.icao || "-",
    call: ac.call || "-", // The callsign
    oc: ac.oc || "-", // The origin country
    // posTime: ac.posTime, // Unix timestamp (seconds) for the last position update
    // lastSeen
    lon: ac.lon,
    lat: ac.lat,
    // bAlt
    alt: ac.gAlt || 0, // Geometric altitude in meters. Can be null.
    gnd: ac.gnd || false, // true or false
    spd: ac.spd || 0, // Velocity over ground in m/s. Can be null.
    brng: ac.brng || 0, // The bearing from the browser to the aircraft clockwise from 0° north
    vsi: ac.vsi || 0, // Vertical rate in m/s.
    // gAlt,
    sqk: ac.sqk || "",
    help: ac.sqk === "7500" || ac.sqk === "7600" || ac.sqk === "7700", // True if the aircraft is transmitting an emergency squawk
    // 7500 = Hijack code, 7600 = Lost Communications, radio problem, 7700 = Emergency
    // spi
    reg: ac.reg || "-", // the aircraft registration
    from: ac.from || "-", // the departure airport
    to: ac.to || "-", // the destination airport
    op: ac.op || "-", // the operator
    mdl: ac.mdl || "-", // the aircraft model (and make?)
    mil: ac.mil || false, // true if known military aircraft
    dst: ac.dst / 1000 || 0, // The distance to the aircraft in kilometres.
    loc: ac.locString || "-", // the geo location Country-Area-City
    // trackStart
    tsecs: ac.tsecs || 0, // tracking time in seconds
  };
  return tokens;
}

class RadarDevice extends Homey.Device {
  // this method is called when the Device is inited
  async onInit() {
    this.log(`device init ${this.getClass()} ${this.getName()}`);
    clearInterval(this.intervalIdDevicePoll); // if polling, stop polling

    // maintenance, removing old and add new capabilities
    if (this.hasCapability("ac_number") === true) {
      await this.removeCapability("ac_number");
    }
    if (this.hasCapability("measure_ac_number") === false) {
      await this.addCapability("measure_ac_number");
    }

    // Check and add the api_credits capability dynamically
    if (!this.hasCapability("api_credits")) {
      await this.addCapability("api_credits");
    }

    this.radarServices = {
      openSky: {
        name: "openSky",
        capabilities: ["measure_ac_number", "to", "op", "mdl", "dst", "alt", "oc"],
        APIKey: false,
      },
      adsbExchangeFeeder: {
        name: "adsbExchangeFeeder",
        capabilities: ["measure_ac_number", "to", "op", "mdl", "dst", "alt", "oc"],
        APIKey: true,
      },
    };

    this.settings = this.getSettings();
    this.radar = new Radar[this.settings.service](this.settings);
    this.acList = [];
    this.flowCards = {};
    this.registerFlowCards();

    // Set up callback to receive API credits
    this.radar.setCreditsUpdateCallback(this.updateApiCredits.bind(this));

    // Initialize api_credits capability
    this.setCapability("api_credits", 0);

    this.radarServices.openSky.capabilities.forEach((capability) => {
      this.registerCapabilityListener(capability, async (value) => {
        this.log(`Capability ${capability} changed to ${value}`);
        // Add your logic to handle the capability change
        return Promise.resolve();
      });
    });

    this.intervalIdDevicePoll = setInterval(async () => {
      try {
        this.scan();
      } catch (error) {
        this.log("intervalIdDevicePoll error", error);
      }
    }, 1000 * this.getSetting("pollingInterval"));
  }

  // Callback to update API credits

  updateApiCredits(credits) {
    this.setCapabilityValue("api_credits", credits).catch((error) => {
      this.log("Error setting api_credits:", error);
    });

    // Activate failover if API credits are depleted
    if (credits <= 0 && this.settings.failoverToOwnData && this.settings.feederSerial) {
      // Notify the user about failover activation
      this.homey.notifications
        .createNotification({
          excerpt: "OpenSky API credits depleted. Switching to own feeder data.",
          state: "warning",
        })
        .catch((err) => {
          this.log("Error sending notification:", err);
        });
    }
/*
    // Deactivate failover if API credits are restored
    if (credits > 0 && this.settings.failoverToOwnData && this.settings.feederSerial) {
      // Notify the user about failover deactivation
      this.homey.notifications
        .createNotification({
          excerpt: "OpenSky API credits restored. Switching back to OpenSky API.",
          state: "ok",
        })
        .catch((err) => {
          this.log("Error sending notification:", err);
        });
    }*/
  }

  // this method is called when the Device is added
  async onAdded() {
    this.log(`radar added: ${this.getData().id}`);
  }

  // this method is called when the Device is deleted
  async onDeleted() {
    this.log(`radar deleted: ${this.getData().id}`);
    clearInterval(this.intervalIdDevicePoll);
  }

  // This method is called when the user has changed the device's settings in Homey.
  async onSettings(newSettingsObj, oldSettingsObj, changedKeysArr) {
    try {
      // First stop polling the device, then start init after a short delay
      clearInterval(this.intervalIdDevicePoll);
      this.log("radar device settings changed");

      // Set device as available
      await this.setAvailable();

      // Restart the device initialization after a delay
      setTimeout(() => {
        this.onInit();
      }, 10000);

      // Indicate success by returning a resolved promise
      return Promise.resolve(true);
    } catch (error) {
      this.error(error);

      // Return a rejected promise to indicate failure
      return Promise.reject(error);
    }
  }

  setCapability(capability, value) {
    if (this.hasCapability(capability)) {
      this.setCapabilityValue(capability, value).catch((error) => {
        this.log(error, capability, value);
      });
    }
  }

  async scan() {
    try {
      const acArray = await this.radar.getAcInRange();
      // Combine multiple filter conditions to avoid multiple iterations
      let newAcList = acArray.filter((ac) => {
        return (
          (!this.settings.onlyGnd || ac.gnd) && // on_ground
          (!this.settings.onlyAir || !ac.gnd) && // not on_ground
          (!this.settings.int || ac.spi) && // special purpose indicator
          (this.settings.sqk === "" || this.settings.sqk === ac.sqk)
        ); // squawk filter
      });

      // **Enforce Radar Range Only When Using Own Data**
      if (this.settings.fallbackOwnData && this.settings.feederSerial) {
        // Ensure that 'this.radar.range' is defined and is a number
        if (typeof this.radar.range !== "number") {
          this.log(`Error: radar.range is not a number. Received: ${this.radar.range}`);
          return;
        }

        // Filter aircraft within the defined range (meters)
        const filteredAcList = newAcList.filter((ac) => ac.dst <= this.radar.range);
        newAcList = filteredAcList; // Update the list with filtered aircraft

        if (filteredAcList.length > 0) {
          // **Log the number of aircraft within range**
          this.log(`Using own feeder data - ${filteredAcList.length} aircraft within ${this.radar.range} meters.`);
        }
      }

      // Iterate through new aircrafts in airspace
      newAcList.forEach((ac, index) => {
        // Find matching aircraft from previous acList using find instead of filter
        const acListAc = this.acList.find((item) => item.icao === ac.icao);
        newAcList[index].trackStart = acListAc ? acListAc.trackStart : Date.now();
        newAcList[index].tsecs = Math.round((Date.now() - newAcList[index].trackStart) / 1000) || 0;

        // Check if aircraft is entering airspace
        const knownAc = !!acListAc; // Boolean check if aircraft exists in acList
        const tokens = getTokens(ac);
        if (!knownAc) {
          this.log(`icao: '${ac.icao}' entering airspace!`);
          this.flowCards.acEnteringTrigger.trigger(this, tokens).catch(this.error);
        }
        this.flowCards.acPresentTrigger.trigger(this, tokens).catch(this.error);
      });

      // Check for leaving airspace
      const leftAcList = this.acList.filter((ac) => !newAcList.some((tac) => tac.icao === ac.icao));
      leftAcList.forEach((ac) => {
        this.log(`icao: '${ac.icao}', leaving airspace!`);
        ac.tsecs = Math.round((Date.now() - ac.trackStart) / 1000) || 0;
        const tokens = getTokens(ac);
        this.flowCards.acLeftTrigger.trigger(this, tokens).catch(this.error);
      });

      // Find nearest aircraft
      const nearestAc = newAcList.reduce((acc, current) => (current.dst <= acc.dst ? current : acc), newAcList[0]);

      // Set capabilities based on nearest aircraft
      this.setCapability("measure_ac_number", newAcList.length || 0);
      if (nearestAc) {
        const dist = Math.round(nearestAc.dst / 100) / 10;
        const alt = Math.round(nearestAc.gAlt || nearestAc.bAlt || 0);
        this.setCapability("dst", dist);
        this.setCapability("alt", alt);
        this.setCapability("oc", nearestAc.oc || "-");
        this.setCapability("op", nearestAc.op || "-");
        this.setCapability("to", nearestAc.to || "-");
        this.setCapability("mdl", nearestAc.mdl || "-");
      } else {
        this.setCapability("dst", 0);
        this.setCapability("alt", 0);
        this.setCapability("oc", "-");
        this.setCapability("op", "-");
        this.setCapability("to", "-");
        this.setCapability("mdl", "-");
      }

      // Limit the size of acList to prevent memory buildup
      this.acList = newAcList.slice(-100); // Keep only the last 100 aircrafts or relevant size

      return;
    } catch (error) {
      this.error(error);

      if (error.message?.includes("Rate limit exceeded")) {
        // Notify the user about the rate limit
        await this.homey.notifications
          .createNotification({
            excerpt: "OpenSky API rate limit exceeded. Please wait before making more requests.",
            state: "warning",
          })
          .catch((err) => {
            this.log("Error sending notification:", err);
          });

        // Implement cooldown check
        if (this.radar.retryAfterSeconds) {
          this.log(`Retrying scan after ${this.radar.retryAfterSeconds} seconds due to rate limiting.`);
          setTimeout(() => {
            this.scan();
          }, this.radar.retryAfterSeconds * 1000);
        }

        // Implement failover to own feeder data if enabled and API credits are depleted
        if (this.settings.failoverToOwnData && this.settings.feederSerial && this.radar.apiCredits <= 0) {
          // No additional flags, rely on getAcInRange to use own feeder data
          this.log("Failover to own feeder data activated due to API rate limit exceeded.");
        }
      }
    }
  }

  async registerFlowCards() {
    // register trigger flow cards in SDK3 style
    this.flowCards = {};

    this.flowCards.acEnteringTrigger = await this.homey.flow.getDeviceTriggerCard("ac_entering");
    this.flowCards.acLeftTrigger = await this.homey.flow.getDeviceTriggerCard("ac_left");
    this.flowCards.acPresentTrigger = await this.homey.flow.getDeviceTriggerCard("ac_present");
  }
}

module.exports = RadarDevice;
