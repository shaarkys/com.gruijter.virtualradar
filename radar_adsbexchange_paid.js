/*
Copyright 2018 - 2021, Robin de Gruijter (gruijter@hotmail.com)

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

'use strict';

const https = require('https');
const GeoPoint = require('geopoint');
const qs = require('querystring');

// const util = require('util');
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
// 	}
// }

class VirtualRadar {
	constructor(settings) {
	  this.lat = settings.lat; // WGS-84 latitude in decimal degrees
	  this.lon = settings.lon; // WGS-84 longitude in decimal degrees
	  this.range = settings.dst * 1000; // Radar range in meters
	  this.lastScan = 0; // Unix timestamp for the last radar update
	  this.center = new GeoPoint(this.lat, this.lon);
	  this.timeout = 20000; // Timeout in ms for the HTTP service call
	  this.apiKey = settings.APIKey; // RapidAPI Key
	  this.retryAfterSeconds = null; // For rate limiting
	  this.retryTimestamp = null; // Cooldown period
	  this.onCreditsUpdate = null; // Callback for credits update
	}
  
	// Method to set the callback
	setCreditsUpdateCallback(callback) {
	  this.onCreditsUpdate = callback;
	}
  
	// Determines whether to use own data or general data
	shouldUseOwnData() {
	  const now = Date.now();
	  // Paid API does not use own data, so always return false
	  return false;
	}
  
	// Fetches aircraft in range
	async getAcInRange() {
	  try {
		const now = Date.now();
  
		// Check for rate limiting
		if (this.apiCredits !== null && this.apiCredits <= 0 && this.retryTimestamp && now < this.retryTimestamp) {
		  if (!this.cooldownLogged) {
			console.warn(`In cooldown period due to rate limiting, will retry after ${new Date(this.retryTimestamp)}`);
			this.cooldownLogged = true;
		  }
		  return []; // Return empty array during cooldown
		}
		this.cooldownLogged = false; // Reset cooldown log flag
  
		const bounds = this._getBounds();
		const query = {
		  lamin: bounds.lamin,
		  lomin: bounds.lomin,
		  lamax: bounds.lamax,
		  lomax: bounds.lomax,
		  extended: true,
		};
		const path = `/api/aircraft/json/lat/${this.lat}/lon/${this.lon}/dist/${this.range / 1852}/`; // Convert meters to nautical miles
  
		const headers = {
		  "X-RapidAPI-Host": "adsbexchange-com1.p.rapidapi.com",
		  "X-RapidAPI-Key": this.apiKey,
		  "Content-Length": 0,
		  "cache-control": "no-cache",
		};
  
		const options = {
		  hostname: "adsbexchange-com1.p.rapidapi.com",
		  path: path,
		  headers,
		  method: "GET",
		};
  
		const jsonData = await this._makeRequest(options);
  
		if (!jsonData.ac) {
		  jsonData.ac = [];
		}
  
		const acListPromises = jsonData.ac.map((state) => this._getAcNormal(state));
		let acList = await Promise.all(acListPromises);
  
		// Filter by distance if necessary (already handled by API)
  
		return acList.filter(ac => ac !== null);
	  } catch (error) {
		console.error("Error fetching aircraft in range:", error);
		throw error;
	  }
	}
  
	// Normalize aircraft data
	async _getAcNormal(state) {
	  const ac = {
		icao: state.icao ? state.icao.toUpperCase() : "",
		call: state.call ? state.call.replace(/[^0-9a-zA-Z]+/gm, "") : "",
		oc: state.cou || "",
		posTime: Number(state.postime),
		lastSeen: Number(state.postime),
		lon: Number(state.lon),
		lat: Number(state.lat),
		bAlt: Math.round(Number(state.alt || 0)),
		gnd: state.gnd !== '0',
		spd: Math.round(Number(state.spd || 0) * 1.852), // m/s to km/h
		brng: Number(state.trak),
		vsi: Math.round(Number(state.vsi || 0) * 0.00508), // Assuming vsi is in feet per minute
		gAlt: Math.round(Number(state.galt || 0)),
		sqk: state.sqk,
		spi: state.interested !== '0',
		reg: "",
		from: "",
		to: "",
		op: "",
		mdl: "",
		type: state.type || "",
		mil: false,
		stateSource: "ADS-B Exchange paid API",
		positionSource: state.mlat === "1" ? "MLAT" : state.tisb === "1" ? "TIS-B" : "ADS-B",
		metadataSource: state.type ? "ADS-B Exchange paid API" : "ADS-B Exchange paid API:no-metadata",
		metadataSources: {
		  icaoType: state.type ? "ADS-B Exchange paid API" : "",
		},
	  };
  
	  // Validate latitude and longitude
	  if (isNaN(ac.lat) || isNaN(ac.lon)) {
		return null;
	  }
  
	  // Calculate distance
	  ac.dst = Math.round(this._getAcDistance(ac) * 1000);
  
	  // Enrich data if necessary
	  // Since ADSB Exchange Paid API might not provide additional data, skip enrichment
	  // Alternatively, implement if API supports
  
	  return ac;
	}
  
	// Calculate distance from center
	_getAcDistance(ac) {
	  const acLoc = new GeoPoint(ac.lat, ac.lon);
	  return this.center.distanceTo(acLoc, true); // in nautical miles
	}
  
	// Make HTTPS request
	async _makeRequest(options) {
	  try {
		const res = await this._makeHttpsRequest(options);
  
		if (res.statusCode === 429) {
		  // Rate limit exceeded
		  const retryAfter = parseInt(res.headers['retry-after'], 10) || 3600; // Default to 1 hour
		  this.retryTimestamp = Date.now() + retryAfter * 1000;
		  this.apiCredits = 0;
  
		  if (this.onCreditsUpdate) {
			this.onCreditsUpdate(this.apiCredits);
		  }
  
		  throw new Error(`Rate limit exceeded. Retry after ${retryAfter} seconds.`);
		}
  
		if (res.statusCode !== 200 || !res.headers["content-type"].includes("application/json")) {
		  throw new Error(`Service Error: ${res.statusCode}`);
		}
  
		const jsonData = JSON.parse(res.body);
  
		// Update API credits from headers if available
		const rateLimitRemaining = res.headers["x-rate-limit-remaining"];
		if (rateLimitRemaining !== undefined) {
		  this.apiCredits = parseInt(rateLimitRemaining, 10);
		}
  
		if (this.onCreditsUpdate) {
		  this.onCreditsUpdate(this.apiCredits);
		}
  
		this.lastScan = jsonData.ctime || Date.now();
  
		return jsonData;
	  } catch (error) {
		console.error("Error in _makeRequest:", error);
		throw error;
	  }
	}
  
	// Low-level HTTPS request
	_makeHttpsRequest(options, postData, timeout) {
	  return new Promise((resolve, reject) => {
		const opts = { ...options };
		opts.timeout = timeout || this.timeout;
  
		const req = https.request(opts, (res) => {
		  let resBody = "";
		  res.on("data", (chunk) => {
			resBody += chunk;
		  });
		  res.once("end", () => {
			if (!res.complete) {
			  return reject(new Error("The connection was terminated while the message was still being sent"));
			}
  
			res.body = resBody;
  
			return resolve(res);
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
  
		req.end(postData || "");
	  });
	}
  
	_getBounds() {
	  const bounds = this.center.boundingCoordinates(this.range / 1852, undefined, true); // Convert meters to nautical miles
	  return {
		lamin: bounds[0]._degLat,
		lomin: bounds[0]._degLon,
		lamax: bounds[1]._degLat,
		lomax: bounds[1]._degLon,
	  };
	}
  }
  
  module.exports = VirtualRadar;

/*
{ ac:
   [ { postime: '1559300693078',
       icao: '4845F0',
       reg: 'PH-VHD',
       type: 'SIRA',
       wtc: '1',
       spdtyp: '',
       spd: '',
       altt: '0',
       alt: '900',
       galt: '900',
       talt: '',
       lat: '52.1533',
       lon: '4.983',
       vsit: '0',
       vsi: '',
       trkh: '0',
       ttrk: '',
       trak: '264.9',
       sqk: '7000',
       call: 'PHVHD',
       gnd: '0',
       trt: '1',
       pos: '1',
       mlat: '1',
       tisb: '0',
       sat: '0',
       opicao: '',
       cou: 'Netherlands',
       mil: '0',
	   interested: '0' },
	{ postime: '1559301341505',
		icao: '4CAB6D',
		reg: 'EI-FZI',
		type: 'B738',
		wtc: '2',
		spdtyp: '',
		spd: '398.4',
		altt: '0',
		alt: '38000',
		galt: '38316',
		talt: '',
		lat: '52.134567',
		lon: '5.057602',
		vsit: '0',
		vsi: '0',
		trkh: '0',
		ttrk: '',
		trak: '262.5',
		sqk: '3440',
		call: 'RYR61TW',
		gnd: '0',
		trt: '2',
		pos: '1',
		mlat: '0',
		tisb: '0',
		sat: '0',
		opicao: 'RYR',
		cou: 'Ireland',
		mil: '0',
		interested: '0' }
	],
  total: 2,
  ctime: 1559300697832,
  ptime: 5141 }
*/
