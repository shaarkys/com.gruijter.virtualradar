/* eslint-disable prefer-destructuring */
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
const crypto = require("crypto");
const Radar = require("../../radar");
const { getCredentialDiagnostics } = require("../../lib/credentialDiagnostics");
// const util = require('util');

class RadarDriver extends Homey.Driver {
  async onInit() {
    this.log("ScannerDriver onInit");
    // init some variables

    this.radarServices = {
      openSky: {
        name: "openSky",
        capabilities: ["measure_ac_number", "to", "op", "mdl", "icao_type", "dst", "alt", "oc"],
        APIKey: false,
      },
      adsbExchangePaid: {
        name: "adsbExchangePaid",
        capabilities: ["measure_ac_number", "to", "op", "mdl", "icao_type", "dst", "alt", "oc"],
        APIKey: true,
      },
      localFeeder: {
        name: "localFeeder",
        capabilities: ["measure_ac_number", "to", "op", "mdl", "icao_type", "dst", "alt", "oc"],
        APIKey: false,
      },
      // adsbExchangePaid: {
      // 	name: 'adsbExchangePaid',
      // 	capabilities: ['ac_number', 'to', 'op', 'mdl', 'dst', 'alt', 'oc'],
      // },
    };
  }

  async onPair(socket) {
    socket.setHandler("validate", async (data) => {
      try {
        this.log("save button pressed in frontend");
        const service = data.radarSelection || "openSky";
        const authMethod = (data.authMethod || "oauth2").toLowerCase();

        // Verify if the service exists
        if (!this.radarServices[service]) {
          throw new Error(`Radar service ${service} is not supported.`);
        }

        if (service === "openSky") {
          if (authMethod === "oauth2") {
            if (!data.clientId || !data.clientSecret) {
              throw new Error("OpenSky OAuth2 selected, but client ID or secret is missing.");
            }
          } else if (authMethod === "basic") {
            if (!data.username || !data.password) {
              throw new Error("OpenSky legacy authentication selected, but username or password is missing.");
            }
          }
          this.log(`[Driver:radar] ${getCredentialDiagnostics({
            authMethod,
            clientId: data.clientId,
            clientSecret: data.clientSecret,
            username: data.username,
            password: data.password,
          })}`);
        }

        // Generate a unique id for the device
        const id = `${this.radarServices[service].name}_${crypto.randomBytes(3).toString("hex")}`;
        const name = service;

        const device = {
          name,
          data: { id },
          settings: {
            pollingInterval: 20, // seconds
            lat: Math.round(this.homey.geolocation.getLatitude() * 100000000) / 100000000,
            lon: Math.round(this.homey.geolocation.getLongitude() * 100000000) / 100000000,
            dst: 5, // Distance in kilometres
            int: false,
            sqk: "",
            onlyGnd: false,
            onlyAir: true,
            service: this.radarServices[service].name,
            authMethod: service === "openSky" ? data.authMethod || "oauth2" : "none",
            username: data.username || "",
            password: data.password || "",
            clientId: data.clientId || "",
            clientSecret: data.clientSecret || "",
            APIKey: data.APIKey,
            fallbackOwnData: data.fallbackOwnData || false,
            feederSerial: data.feederSerial || '', 
            failoverToOwnData: data.failoverToOwnData || false,
            localFeederUrl: data.localFeederUrl || "",
            localFeederUnits: data.localFeederUnits || "aviation",
          },
          capabilities: this.radarServices[service].capabilities,
        };

        // Test if settings work
        const opts = device.settings;
        const radar = new Radar[device.settings.service](opts);
        await radar.getAcInRange();

        return device; // Report success to frontend
      } catch (error) {
        this.error("Pair error", error);
        throw error; // Report failure to frontend
      }
    });
  }
}

module.exports = RadarDriver;
