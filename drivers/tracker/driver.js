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

class TrackerDriver extends Homey.Driver {
  async onInit() {
    this.log("TrackerDriver onInit");
    // init some variables
    // moved to device.js
    this.radarServices = {
      openSky: {
        name: "openSky",
        capabilities: ["onoff", "loc", "brng", "alt", "spd", "to", "dst", "ttime"],
        APIKey: false,
      },
      adsbExchangeFeeder: {
        name: "adsbExchangeFeeder",
        capabilities: ["onoff", "loc", "brng", "alt", "spd", "to", "dst", "ttime"],
        APIKey: true,
      },
      // adsbExchangePaid: {
      // 	name: 'adsbExchangePaid',
      // 	capabilities: ['onoff', 'loc', 'brng', 'alt', 'spd', 'to', 'dst', 'tsecs'],
      // },
    };
  }

  async onPair(socket) {
    socket.setHandler("validate", async (data) => {
      try {
        this.log("save button pressed in frontend");
        const service = data.radarSelection || "openSky";
        const id = `${this.radarServices[service].name}_${crypto.randomBytes(3).toString("hex")}`;
        const name = data.ico || data.reg || data.call;

        const device = {
          name,
          data: { id },
          settings: {
            pollingInterval: 20, // seconds
            lat: Math.round(this.homey.geolocation.getLatitude() * 100000000) / 100000000,
            lon: Math.round(this.homey.geolocation.getLongitude() * 100000000) / 100000000,
            dst: 5, // Distance in kilometres
            ico: data.ico || "",
            reg: data.reg || "",
            call: data.call || "",
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
        await radar.getAc(opts); // Testing settings

        return JSON.stringify(device); // Success: Return the device data
      } catch (error) {
        this.error("Pair error", error);
        throw error; // Failure: Throw the error to be handled by Homey
      }
    });
  }
}

module.exports = TrackerDriver;
