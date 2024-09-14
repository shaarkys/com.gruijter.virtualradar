/* eslint-disable prefer-destructuring */
/*
Copyright 2018 -2021, Robin de Gruijter (gruijter@hotmail.com)

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
    this.apiCredits = null;  // Initialize apiCredits
    this.retryAfterSeconds = null;  // Initialize retryAfterSeconds
    // this.fa = new FlightAware();
    this.onCreditsUpdate = null; // Callback for credits update
    
  }

    // Method to set the callback
    setCreditsUpdateCallback(callback) {
      this.onCreditsUpdate = callback;
    }

  // returns an array of aircraft states that are in range
  async getAcInRange() {
    try {
      const bounds = this._getBounds();
      const query = {
        lamin: bounds.lamin, //	lower bound for the latitude in decimal degrees
        lomin: bounds.lomin, //	lower bound for the longitude in decimal degrees
        lamax: bounds.lamax, //	upper bound for the latitude in decimal degrees
        lomax: bounds.lomax, //	upper bound for the longitude in decimal degrees
        extended: true,
      };
      const headers = {
        "cache-control": "no-cache",
        Connection: "Keep-Alive",
      };
      const options = {
        hostname: "opensky-network.org",
        path: `/api/states/all?${qs.stringify(query)}`,
        headers,
        method: "GET",
      };
      const jsonData = await this._makeRequest(options);
      if (!jsonData.states) {
        jsonData.states = [];
      }

      // Fetch and enrich aircraft data
      const acList = jsonData.states.map(async (state) => {
        let ac = await this._getAcNormal(state); // normalize the data
        ac = await this._getRoute(ac); // try to enrich with route information
        ac = await this._getMeta(ac); // try to enrich with metadata (operator, model, etc.)

        // Ensure fallbacks for missing data
        ac.from = ac.from || "N/A";
        ac.to = ac.to || "N/A";
        ac.op = ac.op || "N/A";
        ac.mdl = ac.mdl || "N/A";

        return ac;
      });

      return Promise.all(acList);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  // returns the state of a specific aircraft
  async getAc(ACOpts) {
    try {
      const query = {};
      if (ACOpts.ico !== "") {
        query.icao24 = ACOpts.ico.toLowerCase();
      }
      if (ACOpts.reg !== "") {
        query.reg = ACOpts.reg.toLowerCase();
      }
      if (ACOpts.call !== "") {
        query.callsign = ACOpts.call.toLowerCase();
      }
      const headers = {
        "cache-control": "no-cache",
      };
      const options = {
        hostname: "opensky-network.org",
        path: `/api/states/all?${qs.stringify(query)}`,
        headers,
        method: "GET",
      };
      const jsonData = await this._makeRequest(options);
      if (!jsonData.states) {
        jsonData.states = [];
      }
      // convert state to ac-data
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
      icao: state[0].toUpperCase(),
      call: state[1].replace(/[^0-9a-zA-Z]+/gm, ""),
      oc: state[2],
      posTime: state[3],
      lastSeen: state[4],
      lon: state[5],
      lat: state[6],
      bAlt: Math.round(Number(state[7] || 0)), // galt * 0.3048 = ft > m
      gnd: state[8],
      spd: Math.round(Number(state[9] || 0) * 1.852 * 1.852), // Spd * 1.852 = km/h // speed indication makes no sense
      brng: state[10],
      vsi: Math.round(Number(state[11] || 0) * 1.852), // Spd * 1.852 = km/h,
      sensors: state[12],
      gAlt: Math.round(Number(state[13] || 0)), // galt * 0.3048 = ft> m
      sqk: state[14],
      spi: state[15],
      // posSource: state[16],
      // states not supported by openSky
      reg: "",
      from: "",
      to: "",
      op: "",
      mdl: "",
      // dst: undefined,
      mil: false,
    };
    // calculate the distance
    ac.dst = Math.round(this._getAcDistance(ac) * 1000);
    // const faData = await this.fa.getFlightInfo(ac.callSign);
    // Object.assign(ac, faData);
    const acEnriched = await this._getRoute(ac);
    const acEnriched2 = await this._getMeta(acEnriched);
    return Promise.resolve(acEnriched2);
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
    const acLoc = new GeoPoint(ac.lat, ac.lon);
    return this.center.distanceTo(acLoc, true);
  }

  async _makeRequest(options) {
    try {
      const res = await this._makeHttpsRequest(options);
      if (res.statusCode !== 200 || !res.headers['content-type'].includes('application/json')) {
        throw new Error(`Service: ${res.statusCode}`);
      }
      const jsonData = JSON.parse(res.body);
    // this.log(util.inspect(jsonData, { depth: null, colors: true }));
      // if (jsonData.time === undefined) {
      // 	throw Error('Invalid response from API');
      // }
  
      if (!jsonData.states) {
        jsonData.states = [];
      }
  
      this.lastScan = jsonData.time || Date.now();
      // Store remaining credits
      const remainingCredits = this.apiCredits !== null ? this.apiCredits : 'N/A';
  
      // Assuming you have a way to update device capabilities, you might emit an event or call a callback
      // For example:
      if (this.onCreditsUpdate) {
        this.onCreditsUpdate(remainingCredits);
      }
  
      return jsonData;
    } catch (error) {
      if (error.message.startsWith('Rate limit exceeded')) {
        // Handle rate limit exceeded
        // Optionally, implement a retry mechanism after `retryAfterSeconds`
        this.log(error.message);
      }
      return Promise.reject(error.message);
    }
  } 

  _makeHttpsRequest(options, postData, timeout) {
    return new Promise((resolve, reject) => {
      const opts = { ...options };  // Clone the options to avoid mutation
      opts.timeout = timeout || this.timeout;
  
      // Add authentication if username and password are provided
      if (this.username && this.password) {
        const auth = `${this.username}:${this.password}`;
        const base64Auth = Buffer.from(auth).toString('base64');
        opts.headers['Authorization'] = `Basic ${base64Auth}`;
      }
  
      const req = https.request(opts, (res) => {
        let resBody = '';
        res.on('data', (chunk) => {
          resBody += chunk;
        });
        res.once('end', () => {
          if (!res.complete) {
            this.error('The connection was terminated while the message was still being sent');
            return reject(new Error('The connection was terminated while the message was still being sent'));
          }
  
          // Extract rate limit headers
          const rateLimitRemaining = res.headers['x-rate-limit-remaining'];
          const rateLimitRetryAfter = res.headers['x-rate-limit-retry-after-seconds'];
  
          if (rateLimitRemaining !== undefined) {
            this.apiCredits = parseInt(rateLimitRemaining, 10);
          }
  
          if (rateLimitRetryAfter !== undefined) {
            this.retryAfterSeconds = parseInt(rateLimitRetryAfter, 10);
          }
  
          res.body = resBody;
          if (res.statusCode === 429) {
            const errorMessage = `Rate limit exceeded. Retry after ${this.retryAfterSeconds} seconds.`;
            this.error(errorMessage);
            return reject(new Error(errorMessage));
          }
  
          return resolve(res); // resolve the request
        });
      });
  
      req.on('error', (e) => {
        req.destroy();
        return reject(e);
      });
      req.on('timeout', () => {
        req.destroy();
        return reject(new Error('Request timed out'));
      });
      // req.write(postData);
      req.end(postData || '');
    });
  }
  
}

module.exports = VirtualRadar;
