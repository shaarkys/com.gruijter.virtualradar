/* eslint-disable prefer-destructuring */
/*
Copyright 2018 -2021, Robin de Gruijter

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

const https = require("https");
const qs = require("querystring");
const GeoPoint = require("geopoint");

// const FlightAware = require('./flightaware');

// // this class represents the state of an aircraft
// class AircraftState {
// 	constructor() {
// 		this.icao = ''; //	string	Unique ICAO 24-bit address of the transponder in hex string representation.
// 		this.callSign = ''; //	string	Callsign of the vehicle (8 chars). Can be null if no callsign has been received.
// 		this.reg = ''; //	string The registration.
// 		this.originCountry = ''; //	string	Country name inferred from the ICAO 24-bit address.
// 		this.posTime = 0; // int Unix timestamp (seconds) for the last position update.
// 		this.lastSeen = null; //	int	Unix timestamp (seconds) for the last update in general.
// 		this.lon = 0; //	float	WGS-84 longitude in decimal degrees.
// 		this.lat = 0; //	float	WGS-84 latitude in decimal degrees.
// 		this.bAlt = 0; // float	Barometric altitude in meters.
// 		this.gAlt = 0; //	float	Geometric altitude in meters.
// 		this.gnd = true; //	boolean	Boolean value which indicates if the position was retrieved from a surface position report.
// 		this.spd = 0; //	float	Velocity over ground in m/s.
// 		this.brng = 0; //	float	True track in decimal degrees clockwise from north (north=0°).
// 		this.vr = 0; //	float	Vertical rate in m/s. A positive value indicates that the airplane is climbing.
// 		this.receivers = []; //	IDs of the receivers which contributed to this state vector.
// 		this.sqk = ''; //	string	The transponder code aka Squawk.
// 		this.spi = false; //	boolean	Whether flight status indicates special purpose indicator.
// 		this.posSource = 0; //	int Origin of this state’s position: 0 = ADS-B, 1 = ASTERIX, 2 = MLAT
// 		this.dst = 0; // float Distance from the radar in m.
// 		this.species = 0;
// 		this.type = undefined; // The aircraft model's ICAO type code.
// 		this.mdl = ''; // string A description of the aircraft's model. Can  also include the manufacturer's name.
// 		this.op = ''; // string The name of the aircraft's operator.
// 		this.from = ''; // string The code and name of the departure airport.
// 		this.to = ''; // string  The code and name of the arrival airport.

// 	// 	{ description:
// 	// 		"Track China Cargo (CK) #207 flight from Shanghai Pudong Int'l to Amsterdam Schiphol",
// 	// 	 title: 'China Cargo (CK)  #207',
// 	// 	 origin: 'ZSPD',
// 	// 	 destination: 'EHAM',
// 	// 	 airline: 'CKK',
// 	// 	 aircraftType: 'B77L',
// 	// 	 aircraftMake: 'Boeing',
// 	// 	 aircraftModel: '777-200LR/F',
// 	// 	 engineCategory: 'turbine',
// 	// 	 engineType: 'twin-jet' }
// 	}
// }

// this class represents a virtual radar
class VirtualRadar {
  constructor(settings) {
    this.lat = settings.lat; //	float	WGS-84 latitude in decimal degrees. Can be null.
    this.lon = settings.lon; //	float	WGS-84 longitude in decimal degrees. Can be null.
    this.range = settings.dst * 1000; // float Radar range in m.
    this.lastScan = 0; // int Unix timestamp (seconds) for the last radar update.
    this.center = new GeoPoint(this.lat, this.lon);
    this.timeout = 20000; // int Timeout in ms for the http service call
    this.username = settings.username || null;
    this.password = settings.password || null;
    this.apiCredits = null; // Initialize apiCredits
    this.retryAfterSeconds = null; // Initialize retryAfterSeconds
    this.retryTimestamp = null; // Initialize retryTimestamp for cooldown period
    // this.fa = new FlightAware();
    this.onCreditsUpdate = null; // Callback for credits update
    this.fallbackOwnData = settings.fallbackOwnData || false;
    this.feederSerial = settings.feederSerial || null;
    this.failoverToOwnData = settings.failoverToOwnData || false;
  }

  // Method to set the callback
  setCreditsUpdateCallback(callback) {
    this.onCreditsUpdate = callback;
  }

  // returns an array of aircraft states that are in range
  async getAcInRange() {
    try {
      let path;
      let query;

      if (this.fallbackOwnData && !this.feederSerial) {
        console.warn("Feeder Serial Number is not provided. Falling back to general data.");
        this.fallbackOwnData = false; // Disable fallback to prevent future issues
      }

      // Determine whether to use own data or general data
      const useOwnData = this.shouldUseOwnData();

      if (useOwnData) {
        // Use own data endpoint
        // console.log("Using own data endpoint.");
        path = `/api/states/own?${qs.stringify({ serials: this.feederSerial })}`;
      } else {
        // Use general endpoint
        // console.log("Using general data endpoint.");
        const bounds = this._getBounds();
        query = {
          lamin: bounds.lamin, // lower bound for the latitude in decimal degrees
          lomin: bounds.lomin, // lower bound for the longitude in decimal degrees
          lamax: bounds.lamax, // upper bound for the latitude in decimal degrees
          lomax: bounds.lomax, // upper bound for the longitude in decimal degrees
          extended: true,
        };
        path = `/api/states/all?${qs.stringify(query)}`;
      }

      const headers = {
        "cache-control": "no-cache",
        Connection: "Keep-Alive",
      };

      const options = {
        hostname: "opensky-network.org",
        path: path,
        headers,
        method: "GET",
      };

      const jsonData = await this._makeRequest(options);

      if (!jsonData || !jsonData.states) {
        jsonData.states = [];
      }

      // Fetch and enrich aircraft data
      let acListPromises = jsonData.states.map(async (state) => {
        let ac = await this._getAcNormal(state); // Normalize the data
        if (ac === null) {
          // Invalid aircraft data, skip this aircraft
          return null;
        }
        ac = await this._getRoute(ac); // Try to enrich with route information
        ac = await this._getMeta(ac); // Try to enrich with metadata (operator, model, etc.)

        // Ensure fallbacks for missing data
        ac.from = ac.from || "N/A";
        ac.to = ac.to || "N/A";
        ac.op = ac.op || "N/A";
        ac.mdl = ac.mdl || "N/A";

        return ac;
      });

      // Wait for all aircraft processing to complete
      let acList = await Promise.all(acListPromises);

      // Filter out null entries resulting from invalid aircraft
      acList = acList.filter((ac) => ac !== null);

      // Implement Distance Filtering Only for Own Feeder Data
      if (useOwnData) {
        acList = acList.filter((ac) => ac.dst <= this.range);
        // console.log(`Filtered ${acList.length} aircraft within range (${this.range} meters) from own feeder data.`);
      }

      return acList;
    } catch (error) {
      // Propagate the error to the caller
      return Promise.reject(error);
    }
  }

  // returns the state of a specific aircraft
  async getAc(ACOpts) {
    try {
      let path;
      let query = {};

      if (this.fallbackOwnData && this.feederSerial) {
        // Use own data endpoint
        query.serials = this.feederSerial;
        if (ACOpts.ico !== "") {
          query.icao24 = ACOpts.ico.toLowerCase();
        }
        path = `/api/states/own?${qs.stringify(query)}`;
      } else {
        // Use general endpoint
        if (ACOpts.ico !== "") {
          query.icao24 = ACOpts.ico.toLowerCase();
        }
        if (ACOpts.reg !== "") {
          query.reg = ACOpts.reg.toLowerCase();
        }
        if (ACOpts.call !== "") {
          query.callsign = ACOpts.call.toLowerCase();
        }
        path = `/api/states/all?${qs.stringify(query)}`;
      }

      const headers = {
        "cache-control": "no-cache",
      };

      const options = {
        hostname: "opensky-network.org",
        path: path,
        headers,
        method: "GET",
      };

      const jsonData = await this._makeRequest(options).catch(() => undefined);
      if (!jsonData || !jsonData.states) {
        jsonData.states = [];
      }

      const acList = jsonData.states.map(async (state) => Promise.resolve(await this._getAcNormal(state)));
      return Promise.all(acList);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  // returns the route, operator and flightnumber of a specific aircraft
  async _getRoute(ac) {
    // https://opensky-network.org/api/routes?callsign=KLM57N
    // { callsign: 'KLM52X', route: ['EDDT', 'EHAM'], updateTime: 1561812529000, operatorIata: 'KL', flightNumber: 1826}
    try {
      if (!ac.call) return Promise.resolve(ac);

      const query = { callsign: ac.call };
      const headers = { "cache-control": "no-cache" };
      const options = {
        hostname: "opensky-network.org",
        path: `/api/routes?${qs.stringify(query)}`,
        headers,
        method: "GET",
      };

      const jsonData = await this._makeRequest(options).catch(() => undefined);

      if (!jsonData || !jsonData.callsign) {
        ac.from = "N/A";
        ac.to = "N/A";
        return Promise.resolve(ac);
      }

      // Enrich route details
      ac.from = jsonData.route[0] || "N/A";
      ac.to = jsonData.route[1] || "N/A";
      ac.op = jsonData.operatorIata || ac.op;
      return Promise.resolve(ac);
    } catch (error) {
      return Promise.resolve(ac); // Ensure aircraft object is still returned
    }
  }

  // returns the registration and model of a specific aircraft
  async _getMeta(ac) {
    // https://opensky-network.org/api/metadata/aircraft/icao/a1f788
    // { registration: 'PH-BXE',
    // manufacturerName: 'Boeing',
    // manufacturerIcao: 'BOEING',
    // model: '737NG 8K2/W',
    // typecode: 'B738',
    // serialNumber: '29595',
    // lineNumber: '',
    // icaoAircraftClass: 'L2J',
    // selCal: '',
    // operator: '',
    // operatorCallsign: 'KLM',
    // operatorIcao: 'KLM',
    // operatorIata: '',
    // owner: 'Klm Royal Dutch Airlines',
    // categoryDescription: 'No ADS-B Emitter Category Information',
    // registered: null,
    // regUntil: null,
    // status: '',
    // built: null,
    // firstFlightDate: null,
    // engines: '',
    // modes: false,
    // adsb: false,
    // acars: false,
    // vdl: false,
    // notes: '',
    // country: 'Kingdom of the Netherlands',
    // lastSeen: null,
    // firstSeen: null,
    // icao24: '48415e',
    // timestamp: 1527559200000 }
    try {
      if (!ac.icao) return Promise.resolve(ac);

      const headers = { "cache-control": "no-cache" };
      const options = {
        hostname: "opensky-network.org",
        path: `/api/metadata/aircraft/icao/${ac.icao}`,
        headers,
        method: "GET",
      };

      const jsonData = await this._makeRequest(options).catch(() => undefined);

      if (!jsonData) {
        ac.reg = "N/A";
        ac.mdl = "N/A";
        return Promise.resolve(ac);
      }

      // Enrich aircraft details
      ac.reg = jsonData.registration || "N/A";
      ac.mdl = jsonData.model || "N/A";
      ac.op = jsonData.operatorIcao || ac.op;
      return Promise.resolve(ac);
    } catch (error) {
      return Promise.resolve(ac); // Ensure aircraft object is still returned
    }
  }

  // returns the normalized state of an aircraft
  async _getAcNormal(state) {
    const ac = {
      icao: state[0] ? state[0].toUpperCase() : "",
      call: state[1] ? state[1].replace(/[^0-9a-zA-Z]+/gm, "") : "",
      oc: state[2] || "",
      posTime: state[3],
      lastSeen: state[4],
      lon: state[5],
      lat: state[6],
      bAlt: Math.round(Number(state[7] || 0)),
      gnd: state[8],
      spd: Math.round(Number(state[9] || 0) * 1.852 * 1.852),
      brng: state[10],
      vsi: Math.round(Number(state[11] || 0) * 1.852),
      sensors: state[12],
      gAlt: Math.round(Number(state[13] || 0)),
      sqk: state[14],
      spi: state[15],
      reg: "",
      from: "",
      to: "",
      op: "",
      mdl: "",
      mil: false,
    };

    // Validate latitude and longitude
    if (ac.lat === null || ac.lat === undefined || isNaN(ac.lat) || ac.lon === null || ac.lon === undefined || isNaN(ac.lon)) {
      // Skip this aircraft by returning null
      return null;
    }

    // Calculate the distance
    ac.dst = Math.round(this._getAcDistance(ac) * 1000);

    // Continue processing the aircraft
    const acEnriched = await this._getRoute(ac);
    const acEnriched2 = await this._getMeta(acEnriched);
    return acEnriched2;
  }

  _getBounds() {
    const bounds = this.center.boundingCoordinates(this.range / 1000, undefined, true);
    return {
      lamin: bounds[0]._degLat,
      lomin: bounds[0]._degLon,
      lamax: bounds[1]._degLat,
      lomax: bounds[1]._degLon,
    };
  }

  _getAcDistance(ac) {
    try {
      const acLoc = new GeoPoint(ac.lat, ac.lon);
      return this.center.distanceTo(acLoc, true);
    } catch (error) {
      // Rethrow the error to be caught in the calling method
      throw error;
    }
  }

  // Makes an HTTPS request and returns the JSON data
  async _makeRequest(options) {
    try {
      const res = await this._makeHttpsRequest(options);

      if (res.statusCode === 403) {
        throw new Error("Authentication failed. Please check your username and password.");
      }

      if (res.statusCode !== 200 || !res.headers["content-type"].includes("application/json")) {
        throw new Error(`Service: ${res.statusCode}`);
      }

      const jsonData = JSON.parse(res.body);

      if (!jsonData.states) {
        jsonData.states = [];
      }

      this.lastScan = jsonData.time || Date.now();

      // Store remaining credits
      const rateLimitRemaining = res.headers["x-rate-limit-remaining"];
      if (rateLimitRemaining !== undefined) {
        this.apiCredits = parseInt(rateLimitRemaining, 10);
      }

      // Reset retryTimestamp if we have credits
      if (this.apiCredits !== null && this.apiCredits > 0) {
        this.retryTimestamp = null;
      }

      // Assuming you have a way to update device capabilities, you might emit an event or call a callback
      if (this.onCreditsUpdate) {
        this.onCreditsUpdate(this.apiCredits);
      }

      return jsonData;
    } catch (error) {
      // Reject the promise to propagate the error back to the driver
      return Promise.reject(error);
    }
  }

  _makeHttpsRequest(options, postData, timeout) {
    return new Promise((resolve, reject) => {
      const opts = { ...options }; // Clone the options to avoid mutation
      opts.timeout = timeout || this.timeout;

      // Add authentication if username and password are provided
      if (this.username && this.password) {
        const auth = `${this.username}:${this.password}`;
        const base64Auth = Buffer.from(auth).toString("base64");
        opts.headers["Authorization"] = `Basic ${base64Auth}`;
      }

      const req = https.request(opts, (res) => {
        let resBody = "";
        res.on("data", (chunk) => {
          resBody += chunk;
        });
        res.once("end", () => {
          if (!res.complete) {
            error("The connection was terminated while the message was still being sent");
            return reject(new Error("The connection was terminated while the message was still being sent"));
          }

          // Extract rate limit headers
          const rateLimitRemaining = res.headers["x-rate-limit-remaining"];
          const rateLimitRetryAfter = res.headers["x-rate-limit-retry-after-seconds"];

          if (rateLimitRemaining !== undefined) {
            this.apiCredits = parseInt(rateLimitRemaining, 10);
          }

          if (rateLimitRetryAfter !== undefined) {
            this.retryAfterSeconds = parseInt(rateLimitRetryAfter, 10);
          }

          res.body = resBody;
          if (res.statusCode === 429) {
            this.apiCredits = 0; // To trigger failover, if allowed
            if (this.retryAfterSeconds !== undefined) {
              this.retryTimestamp = Date.now() + (this.retryAfterSeconds + 600) * 1000; // Retry after retryAfterSeconds + 600 seconds
            } else {
              this.retryTimestamp = Date.now() + 3600 * 1000; // Default to 1 hour
            }
            const errorMessage = `Rate limit exceeded - ${this.apiCredits} credits. Retry after ${this.retryAfterSeconds} seconds.`;
            return reject(Error(errorMessage));
          }

          return resolve(res); // resolve the request
        });
      });

      req.on("error", (e) => {
        req.destroy();
        return reject(e);
      });
      req.on("timeout", () => {
        req.destroy();
        return reject(new Error("Request timed out"));
      });
      // req.write(postData);
      req.end(postData || "");
    });
  }

  // New method to determine whether to use own data or general data
  shouldUseOwnData() {
    const now = Date.now();
    if (this.fallbackOwnData && this.feederSerial) {
      return true;
    }

    if (this.failoverToOwnData && this.feederSerial) {
      if (this.apiCredits !== null && this.apiCredits <= 0) {
        if (this.retryTimestamp && now >= this.retryTimestamp) {
          // Time to retry using the general endpoint
          return false;
        } else {
          // Still in cooldown, use own data
          return true;
        }
      }
    }
    // Otherwise, use general endpoint
    return false;
  }
}

module.exports = VirtualRadar;
