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
const qs = require('querystring');
const GeoPoint = require('geopoint');

// const speciesList = {	// needs translation ?
// 	0: 'unknown',	// Onbekend
// 	1: 'land', // Luchtvaartuig
// 	2: 'sea', // Watervliegtuig
// 	3: 'amphibian', // Amfibisch
// 	4: 'helicopter', // Helicopter
// 	5: 'gyrocopter', // Gyrocopter
// 	6: 'tiltwing', // Tiltwing
// 	7: 'vehicle', // Grond voertuig
// 	8: 'tower', // Toren
// };

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
	constructor(lat, lon, range) {
		this.lat = lat;	//	float	WGS-84 latitude in decimal degrees. Can be null.
		this.lon = lon;	//	float	WGS-84 longitude in decimal degrees. Can be null.
		this.range = range * 1000;	// float Radar range in m.
		this.lastScan = 0; // int Unix timestamp (seconds) for the last radar update.
		this.timeout = 15000; // int Timeout in ms for the http service call
		this.center = new GeoPoint(this.lat, this.lon);
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
			};
			// const user = 'gruijter';
			// const apiKey = 'PUT IN KEY HERE';
			const headers = {
				'cache-control': 'no-cache',
				auth: 'user:apiKey',
			};
			const options = {
				hostname: 'flightxml.flightaware.com',
				path: `/json/FlightXML3/search?${qs.stringify(query)}`,
				headers,
				method: 'GET',
			};
			const result = await this._makeHttpsRequest(options);
			if (result.statusCode !== 200 || !result.headers['content-type'].includes('application/json')) {
				throw Error(`API error : ${result.statusCode}`);
			}
			const jsonData = JSON.parse(result.body);
			// this.log(util.inspect(jsonData, { depth: null, colors: true }));
			if (jsonData.time === undefined) {
				throw Error('Invalid response from API');
			}
			this.lastScan = jsonData.time;
			if (!jsonData.states) {
				jsonData.states = [];
			}
			// convert state to ac-data
			const acList = jsonData.states
				.map((state) => Promise.resolve(this._getAc(state)));
			return Promise.all(acList);
		} catch (error) {
			return Promise.resolve(error);
		}
	}

	async _getAc(state) {
		const ac = {
			icao: state[0],
			callSign: state[1].replace(/[^0-9a-zA-Z]+/gm, ''),
			originCountry: state[2],
			posTime: state[3],
			lastSeen: state[4],
			lon: state[5],
			lat: state[6],
			bAlt: state[7],
			gnd: state[8],
			spd: state[9],
			brng: state[10],
			vs: state[11],
			sensors: state[12],
			gAlt: state[13],
			sqk: state[14],
			spi: state[15],
			posSource: state[16],
		};
		// calculate the distance
		ac.dst = Math.round(this._getAcDistance(ac) * 1000);
		const faData = await this.fa.getFlightInfo(ac.callSign);
		Object.assign(ac, faData);
		return Promise.resolve(ac);
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

	_makeHttpsRequest(options, postData, timeout) {
		return new Promise((resolve, reject) => {
			const opts = options;
			opts.timeout = timeout || this.timeout;
			const req = https.request(opts, (res) => {
				let resBody = '';
				res.on('data', (chunk) => {
					resBody += chunk;
				});
				res.once('end', () => {
					if (!res.complete) {
						this.error('The connection was terminated while the message was still being sent');
						return reject(Error('The connection was terminated while the message was still being sent'));
					}
					res.body = resBody;
					return resolve(res); // resolve the request
				});
			});
			req.on('error', (e) => {
				req.destroy();
				return reject(e);
			});
			req.on('timeout', () => {
				req.destroy();
			});
			// req.write(postData);
			req.end(postData || '');
		});
	}

}

module.exports = VirtualRadar;
