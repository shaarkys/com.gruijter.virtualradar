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
// const util = require('util');

class RadarDriver extends Homey.Driver {
  async onInit() {
    this.log("ScannerDriver onInit");
    // init some variables

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
            username: data.username || '',
            password: data.password || '',
            APIKey: data.APIKey,
            fallbackOwnData: data.fallbackOwnData || false,
            feederSerial: data.feederSerial || '', 
            failoverToOwnData: data.failoverToOwnData || false,
          },
          capabilities: this.radarServices[service].capabilities,
        };

        // Test if settings work
        const opts = device.settings;
        const radar = new Radar[device.settings.service](opts);
        await radar.getAcInRange();

        return JSON.stringify(device); // Report success to frontend
      } catch (error) {
        this.error("Pair error", error);
        throw error; // Report failure to frontend
      }
    });
  }
}

module.exports = RadarDriver;
