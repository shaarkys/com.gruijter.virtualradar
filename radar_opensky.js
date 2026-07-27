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
const { getCredentialDiagnostics } = require("./lib/credentialDiagnostics");

const AIRCRAFT_METADATA_CACHE_TTL = 24 * 60 * 60 * 1000;
const AIRCRAFT_METADATA_MISS_CACHE_TTL = 60 * 60 * 1000;
const AIRCRAFT_METADATA_ERROR_CACHE_TTL = 5 * 60 * 1000;
const MAX_AIRCRAFT_METADATA_CACHE_ENTRIES = 1000;
const OPEN_SKY_POSITION_SOURCES = {
  0: "ADS-B",
  1: "ASTERIX",
  2: "MLAT",
  3: "FLARM",
};

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
    const hasOAuthCredentials = settings.clientId && settings.clientSecret;
    const hasBasicCredentials = settings.username && settings.password;
    this.authMethod = (settings.authMethod || "").toLowerCase() || (hasOAuthCredentials ? "oauth2" : hasBasicCredentials ? "basic" : "none");
    this.username = settings.username || null;
    this.password = settings.password || null;
    this.clientId = settings.clientId || null;
    this.clientSecret = settings.clientSecret || null;
    this.accessToken = null;
    this.accessTokenExpiresAt = 0;
    this._authLogged = false;
    this.apiCredits = null; // Initialize apiCredits
    this.retryAfterSeconds = null; // Initialize retryAfterSeconds
    this.retryTimestamp = null; // Initialize retryTimestamp for cooldown period
    // this.fa = new FlightAware();
    this.onCreditsUpdate = null; // Callback for credits update
    this.fallbackOwnData = settings.fallbackOwnData || false;
    this.feederSerial = settings.feederSerial || null;
    this.failoverToOwnData = settings.failoverToOwnData || false;
    this.aircraftMetadataCache = new Map();

    this.cooldownLogged = false; // Initialize the cooldown log flag
  }

  // Method to set the callback
  setCreditsUpdateCallback(callback) {
    this.onCreditsUpdate = callback;
  }

  // Returns an array of aircraft states that are in range
async getAcInRange() {
  try {
    const now = Date.now();

    // Determine whether to use own data or general data
    const useOwnData = this.shouldUseOwnData();

    // Check for rate limiting only if not using own data
    if (!useOwnData && this.apiCredits !== null && this.apiCredits <= 0 && this.retryTimestamp && now < this.retryTimestamp) {
      // We are in cooldown due to rate limiting
      if (!this.cooldownLogged) {
        console.warn(`In cooldown period due to rate limiting, will retry after ${new Date(this.retryTimestamp)}`);
        this.cooldownLogged = true;
      }
      return []; // Return empty array or cached data
    }
    this.cooldownLogged = false; // Reset the flag if not in cooldown

    let path;
    let query;

    if (this.fallbackOwnData && !this.feederSerial) {
      console.warn("Feeder Serial Number is not provided. Falling back to general data.");
      this.fallbackOwnData = false; // Disable fallback to prevent future issues
    }

    // Determine the API endpoint to use based on whether we are using own data
    if (useOwnData) {
      // Use own data endpoint
      path = `/api/states/own?${qs.stringify({ serials: this.feederSerial })}`;
    } else {
      // Use general endpoint
      const bounds = this._getBounds();
      query = {
        lamin: bounds.lamin, // Lower bound for the latitude in decimal degrees
        lomin: bounds.lomin, // Lower bound for the longitude in decimal degrees
        lamax: bounds.lamax, // Upper bound for the latitude in decimal degrees
        lomax: bounds.lomax, // Upper bound for the longitude in decimal degrees
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

    // Make the request to OpenSky API
    const jsonData = await this._makeRequest(options);

    if (!jsonData || !jsonData.states) {
      jsonData.states = [];
    }

    // Fetch and enrich aircraft data
    let acListPromises = jsonData.states.map(async (state) => {
      let ac = await this._getAcNormal(
        state,
        useOwnData ? "OpenSky own-feed API" : "OpenSky states API"
      ); // Normalize the data
      if (ac === null) {
        // Invalid aircraft data, skip this aircraft
        return null;
      }

      // Ensure fallbacks for missing data
      ac.from = ac.from || "N/A";
      ac.to = ac.to || "N/A";
      ac.op = ac.op || "N/A";
      ac.mdl = ac.mdl || "N/A";
      ac.type = ac.type || "N/A";

      return ac;
    });

    // Wait for all aircraft processing to complete
    let acList = await Promise.all(acListPromises);

    // Filter out null entries resulting from invalid aircraft
    acList = acList.filter((ac) => ac !== null);

    // Implement distance filtering only for own feeder data
    if (useOwnData) {
      acList = acList.filter((ac) => ac.dst <= this.range);
    }

    return acList;
  } catch (error) {
    // Propagate the error to the caller
    return Promise.reject(error);
  }
}

  // Returns the state of a specific aircraft
async getAc(ACOpts) {
  try {
    const now = Date.now();

    // Determine whether to use own data or general data
    const useOwnData = this.shouldUseOwnData();

    // Check for rate limiting only if not using own data
    if (!useOwnData && this.apiCredits !== null && this.apiCredits <= 0 && this.retryTimestamp && now < this.retryTimestamp) {
      // We are in cooldown due to rate limiting
      if (!this.cooldownLogged) {
        console.warn(`In cooldown period due to rate limiting, will retry after ${new Date(this.retryTimestamp)}`);
        this.cooldownLogged = true;
      }
      return []; // Return empty array or cached data
    }
    this.cooldownLogged = false; // Reset the flag if not in cooldown

    let path;
    let query = {};

    if (this.fallbackOwnData && !this.feederSerial) {
      console.warn("Feeder Serial Number is not provided. Falling back to general data.");
      this.fallbackOwnData = false; // Disable fallback to prevent future issues
    }

    // Determine the API endpoint to use based on whether we are using own data
    if (useOwnData) {
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

    // Make the request to OpenSky API
    const jsonData = await this._makeRequest(options).catch(() => undefined);
    if (!jsonData || !jsonData.states) {
      jsonData.states = [];
    }

    // Normalize and process each aircraft state
    const stateSource = useOwnData ? "OpenSky own-feed API" : "OpenSky states API";
    const acList = jsonData.states.map(async (state) => Promise.resolve(await this._getAcNormal(state, stateSource)));
    return Promise.all(acList);
  } catch (error) {
    return Promise.reject(error);
  }
}


  // Returns the registration, model, type and operator of a specific aircraft.
  async _getMeta(ac) {
    try {
      if (!ac.icao) return Promise.resolve(ac);

      const metadata = await this._getAircraftMetadata(ac.icao);
      if (!metadata) {
        ac.reg = "N/A";
        ac.mdl = "N/A";
        ac.type = "N/A";
        ac.metadataSource = "ADSBDB+HexDB:no-result";
        ac.metadataSources = {};
        return Promise.resolve(ac);
      }

      // Enrich aircraft details
      ac.reg = metadata.registration || "N/A";
      ac.mdl = metadata.type || "N/A";
      ac.type = metadata.icao_type || "N/A";
      ac.op = metadata.registered_owner_operator_flag_code || metadata.registered_owner || ac.op;
      ac.metadataSources = metadata._sources || {};
      ac.metadataSource = [...new Set(Object.values(ac.metadataSources).filter(Boolean))].join("+") || "unknown";
      return Promise.resolve(ac);
    } catch (error) {
      return Promise.resolve(ac); // Ensure aircraft object is still returned
    }
  }

  async _getAircraftMetadata(icao) {
    const cacheKey = icao.toUpperCase();
    const cached = this.aircraftMetadataCache.get(cacheKey);
    if (cached && cached.promise) {
      return cached.promise;
    }
    if (cached && cached.expiresAt > Date.now()) {
      return cached.metadata;
    }
    if (cached) {
      this.aircraftMetadataCache.delete(cacheKey);
    }

    const promise = this._fetchAircraftMetadata(cacheKey)
      .then((metadata) => {
        this._cacheAircraftMetadata(cacheKey, metadata, metadata ? AIRCRAFT_METADATA_CACHE_TTL : AIRCRAFT_METADATA_MISS_CACHE_TTL);
        return metadata;
      })
      .catch((error) => {
        console.warn(`[OpenSky] Aircraft metadata lookup failed for ${cacheKey}: ${error.message || error}`);
        this._cacheAircraftMetadata(cacheKey, null, AIRCRAFT_METADATA_ERROR_CACHE_TTL);
        return null;
      });

    this.aircraftMetadataCache.set(cacheKey, { promise });
    return promise;
  }

  async _fetchAircraftMetadata(icao) {
    let adsbDbError;
    let adsbDbMetadata;
    try {
      adsbDbMetadata = await this._fetchAdsbDbMetadata(icao);
      if (adsbDbMetadata && adsbDbMetadata.icao_type) return adsbDbMetadata;
    } catch (error) {
      adsbDbError = error;
    }

    try {
      const metadata = await this._fetchHexDbMetadata(icao);
      if (metadata) {
        const adsbDbSources = (adsbDbMetadata && adsbDbMetadata._sources) || {};
        const hexDbSources = metadata._sources || {};
        return {
          type: (adsbDbMetadata && adsbDbMetadata.type) || metadata.type,
          icao_type: (adsbDbMetadata && adsbDbMetadata.icao_type) || metadata.icao_type,
          registration: (adsbDbMetadata && adsbDbMetadata.registration) || metadata.registration,
          registered_owner_operator_flag_code:
            (adsbDbMetadata && adsbDbMetadata.registered_owner_operator_flag_code)
            || metadata.registered_owner_operator_flag_code,
          registered_owner: (adsbDbMetadata && adsbDbMetadata.registered_owner) || metadata.registered_owner,
          _sources: {
            model: (adsbDbMetadata && adsbDbMetadata.type) ? adsbDbSources.model : hexDbSources.model,
            icaoType: (adsbDbMetadata && adsbDbMetadata.icao_type) ? adsbDbSources.icaoType : hexDbSources.icaoType,
            registration: (adsbDbMetadata && adsbDbMetadata.registration)
              ? adsbDbSources.registration
              : hexDbSources.registration,
            operator: (
              adsbDbMetadata
              && (adsbDbMetadata.registered_owner_operator_flag_code || adsbDbMetadata.registered_owner)
            )
              ? adsbDbSources.operator
              : hexDbSources.operator,
          },
        };
      }
    } catch (error) {
      const adsbDbMessage = adsbDbError ? `${adsbDbError.message || adsbDbError}; ` : "";
      throw new Error(`${adsbDbMessage}${error.message || error}`);
    }

    if (adsbDbError) throw adsbDbError;
    return adsbDbMetadata || null;
  }

  async _fetchAdsbDbMetadata(icao) {
    const options = {
      hostname: "api.adsbdb.com",
      path: `/v0/aircraft/${encodeURIComponent(icao)}`,
      headers: {
        Accept: "application/json",
        "User-Agent": "com.gruijter.virtualradar",
      },
      method: "GET",
      skipAuth: true,
      trackRateLimit: false,
    };
    const res = await this._makeHttpsRequest(options);
    if (res.statusCode === 404) {
      return null;
    }
    const contentType = res.headers["content-type"] || "";
    if (res.statusCode !== 200 || !contentType.includes("application/json")) {
      throw new Error(`ADSBDB service error: ${res.statusCode}`);
    }

    const jsonData = JSON.parse(res.body);
    const aircraft = jsonData.response && jsonData.response.aircraft;
    if (!aircraft) return null;
    return {
      ...aircraft,
      _sources: {
        model: aircraft.type ? "ADSBDB" : "",
        icaoType: aircraft.icao_type ? "ADSBDB" : "",
        registration: aircraft.registration ? "ADSBDB" : "",
        operator: aircraft.registered_owner_operator_flag_code || aircraft.registered_owner ? "ADSBDB" : "",
      },
    };
  }

  async _fetchHexDbMetadata(icao) {
    const options = {
      hostname: "hexdb.io",
      path: `/api/v1/aircraft/${encodeURIComponent(icao)}`,
      headers: {
        Accept: "application/json",
        "User-Agent": "com.gruijter.virtualradar",
      },
      method: "GET",
      skipAuth: true,
      trackRateLimit: false,
    };
    const res = await this._makeHttpsRequest(options);
    if (res.statusCode === 404) {
      return null;
    }
    const contentType = res.headers["content-type"] || "";
    if (res.statusCode !== 200 || !contentType.includes("application/json")) {
      throw new Error(`HexDB service error: ${res.statusCode}`);
    }

    const jsonData = JSON.parse(res.body);
    if (!jsonData || !jsonData.ICAOTypeCode) {
      return null;
    }
    return {
      type: jsonData.Type,
      icao_type: jsonData.ICAOTypeCode,
      registration: jsonData.Registration,
      registered_owner_operator_flag_code: jsonData.OperatorFlagCode,
      registered_owner: jsonData.RegisteredOwners,
      _sources: {
        model: jsonData.Type ? "HexDB" : "",
        icaoType: jsonData.ICAOTypeCode ? "HexDB" : "",
        registration: jsonData.Registration ? "HexDB" : "",
        operator: jsonData.OperatorFlagCode || jsonData.RegisteredOwners ? "HexDB" : "",
      },
    };
  }

  _cacheAircraftMetadata(cacheKey, metadata, ttl) {
    this.aircraftMetadataCache.delete(cacheKey);
    this.aircraftMetadataCache.set(cacheKey, {
      metadata,
      expiresAt: Date.now() + ttl,
    });
    while (this.aircraftMetadataCache.size > MAX_AIRCRAFT_METADATA_CACHE_ENTRIES) {
      const oldestKey = this.aircraftMetadataCache.keys().next().value;
      this.aircraftMetadataCache.delete(oldestKey);
    }
  }

  // returns the normalized state of an aircraft
  async _getAcNormal(state, stateSource = "OpenSky states API") {
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
      type: "",
      mil: false,
      stateSource,
      positionSource: OPEN_SKY_POSITION_SOURCES[state[16]] || `OpenSky position source ${state[16] ?? "unknown"}`,
      metadataSource: "ADSBDB+HexDB:pending",
      metadataSources: {},
    };

    // Validate latitude and longitude
    if (ac.lat === null || ac.lat === undefined || isNaN(ac.lat) || ac.lon === null || ac.lon === undefined || isNaN(ac.lon)) {
      // Skip this aircraft by returning null
      return null;
    }

    // Calculate the distance
    ac.dst = Math.round(this._getAcDistance(ac) * 1000);

    // OpenSky no longer provides live route or aircraft metadata endpoints.
    ac.from = "N/A";
    ac.to = "N/A";
    return this._getMeta(ac);
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
      const res = await this._requestWithAuth(options);

      if (res.statusCode === 429) {
        // Rate limit exceeded
        this.apiCredits = 0; // Set credits to zero
        let retryAfter = parseInt(res.headers['retry-after'], 10);
        if (isNaN(retryAfter)) {
          retryAfter = 3600; // Default to 1 hour
        }
        this.retryTimestamp = Date.now() + retryAfter * 1000;
        throw new Error(`Rate limit exceeded. Retry after ${retryAfter} seconds.`);
      }

      const contentType = res.headers["content-type"] || "";
      if (res.statusCode !== 200 || !contentType.includes("application/json")) {
        throw new Error(`Service Error: ${res.statusCode}`);
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
      if (error.message.includes('Rate limit exceeded')) {
        // Ensure apiCredits is set to zero
        this.apiCredits = 0;

        // Notify about credits update
        if (this.onCreditsUpdate) {
          this.onCreditsUpdate(this.apiCredits);
        }
      }
      // Reject the promise to propagate the error back to the driver
      return Promise.reject(error);
    }
  }

  async _getAuthHeader() {
    if (!this._authLogged) {
      console.log(
        `[OpenSky] ${getCredentialDiagnostics({
          authMethod: this.authMethod,
          clientId: this.clientId,
          clientSecret: this.clientSecret,
          username: this.username,
          password: this.password,
        })}`
      );
      this._authLogged = true;
    }
    if (this.authMethod === "oauth2") {
      if (!this.clientId || !this.clientSecret) {
        throw new Error("OAuth2 selected but client_id or client_secret is missing.");
      }
      const token = await this._getAccessToken();
      return `Bearer ${token}`;
    }
    if (this.authMethod === "basic" && this.username && this.password) {
      const auth = `${this.username}:${this.password}`;
      const base64Auth = Buffer.from(auth).toString("base64");
      return `Basic ${base64Auth}`;
    }
    return null;
  }

  async _getAccessToken() {
    const aboutToExpire = Date.now() + 60000; // refresh 1 minute before expiry
    if (this.accessToken && this.accessTokenExpiresAt && aboutToExpire < this.accessTokenExpiresAt) {
      return this.accessToken;
    }

    const postData = qs.stringify({
      grant_type: "client_credentials",
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });

    const options = {
      hostname: "auth.opensky-network.org",
      path: "/auth/realms/opensky-network/protocol/openid-connect/token",
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(postData),
      },
      skipAuth: true,
    };

    const res = await this._makeHttpsRequest(options, postData);
    if (res.statusCode !== 200) {
      throw new Error(`OAuth token request failed with status ${res.statusCode}`);
    }

    let tokenBody;
    try {
      tokenBody = JSON.parse(res.body);
    } catch (err) {
      throw new Error("OAuth token response is not valid JSON");
    }

    if (!tokenBody.access_token) {
      throw new Error("OAuth token response missing access_token");
    }

    const expiresInSeconds = Number(tokenBody.expires_in) || 1800;
    this.accessToken = tokenBody.access_token;
    this.accessTokenExpiresAt = Date.now() + (expiresInSeconds - 30) * 1000; // refresh a bit early
    return this.accessToken;
  }

  _invalidateAccessToken() {
    this.accessToken = null;
    this.accessTokenExpiresAt = 0;
  }

  async _requestWithAuth(options) {
    const baseHeaders = options.headers || {};
    const headers = { ...baseHeaders };
    const opts = { ...options, headers };

    try {
      const authHeader = await this._getAuthHeader();
      if (authHeader) {
        opts.headers.Authorization = authHeader;
      }
    } catch (authError) {
      return Promise.reject(authError);
    }

    let res = await this._makeHttpsRequest(opts);

    if (res.statusCode === 401 && this.authMethod === "oauth2") {
      // Token might be expired; try once more after refreshing
      this._invalidateAccessToken();
      const retryHeaders = { ...baseHeaders };
      const retryOpts = { ...options, headers: retryHeaders };
      const authHeader = await this._getAuthHeader();
      if (authHeader) {
        retryOpts.headers.Authorization = authHeader;
      }
      res = await this._makeHttpsRequest(retryOpts);
    }

    if (res.statusCode === 401 || res.statusCode === 403) {
      throw new Error("Authentication failed. Please verify your OpenSky credentials or OAuth client settings.");
    }

    return res;
  }

  _makeHttpsRequest(options, postData, timeout) {
    return new Promise((resolve, reject) => {
      const opts = { ...options }; // Clone the options to avoid mutation
      opts.timeout = timeout || this.timeout;
      opts.headers = { ...(opts.headers || {}) };

      // Add authentication if username and password are provided for basic auth
      if (!opts.skipAuth && this.authMethod === "basic" && this.username && this.password && !opts.headers.Authorization) {
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
            return reject(new Error("The connection was terminated while the message was still being sent"));
          }

          res.body = resBody;

          if (res.statusCode === 429 && opts.trackRateLimit !== false) {
            // Rate limit exceeded
            this.apiCredits = 0;
            let retryAfter = parseInt(res.headers['retry-after'], 10);
            if (isNaN(retryAfter)) {
              retryAfter = 3600; // Default to 1 hour
            }
            this.retryTimestamp = Date.now() + retryAfter * 1000;
            return reject(new Error(`Rate limit exceeded. Retry after ${retryAfter} seconds.`));
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

  // Method to determine whether to use own data or general data
  shouldUseOwnData() {
    const now = Date.now();
    if (this.fallbackOwnData && this.feederSerial) {
      return true;
    }

    if (this.failoverToOwnData && this.feederSerial) {
      if (this.apiCredits !== null && this.apiCredits <= 0) {
        if (this.retryTimestamp && now < this.retryTimestamp) {
          // Still in cooldown, use own data
          return true;
        } else if (this.retryTimestamp && now >= this.retryTimestamp) {
          // Cooldown over, attempt API again
          return false;
        } else {
          // No retryTimestamp set, assume in cooldown
          return true;
        }
      }
    }
    // Use general endpoint
    return false;
  }
}

module.exports = VirtualRadar;
