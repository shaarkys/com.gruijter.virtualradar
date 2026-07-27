/*
Copyright 2018 - 2021, Robin de Gruijter

This file is part of com.gruijter.virtualradar.

com.gruijter.virtualradar is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

"use strict";

const http = require("http");
const https = require("https");
const GeoPoint = require("geopoint");

const DEFAULT_PATHS = [
  "/data/aircraft.json",
  "/dump1090-fa/data/aircraft.json",
  "/dump1090/data/aircraft.json",
  "/skyaware/data/aircraft.json",
  "/readsb/data/aircraft.json",
  "/tar1090/data/aircraft.json",
  "/VirtualRadar/AircraftList.json",
];
const MAX_RESPONSE_SIZE = 10 * 1024 * 1024;

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function toNumber(value) {
  if (value === undefined || value === null || value === "" || value === "ground") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toBoolean(value) {
  if (typeof value === "string") {
    return ["1", "true", "yes", "ground"].includes(value.toLowerCase());
  }
  return Boolean(value);
}

function cleanIdentifier(value) {
  return value ? String(value).replace(/[^0-9a-zA-Z]+/gm, "").toUpperCase() : "";
}

class LocalFeederRadar {
  constructor(settings) {
    this.lat = Number(settings.lat);
    this.lon = Number(settings.lon ?? settings.lng);
    this.range = Number(settings.dst) * 1000;
    this.center = new GeoPoint(this.lat, this.lon);
    this.timeout = 5000;
    this.units = settings.localFeederUnits || "aviation";
    this.candidateUrls = LocalFeederRadar.getCandidateUrls(settings.localFeederUrl);
    this.resolvedEndpoint = null;
    this.lastScan = 0;
    this.apiCredits = null;
    this.retryAfterSeconds = null;
    this.retryTimestamp = null;
    this.onCreditsUpdate = null;
  }

  static getCandidateUrls(input) {
    if (!input || !String(input).trim()) {
      throw new Error("Enter the local ADS-B feeder URL or IP address.");
    }

    const rawInput = String(input).trim();
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(rawInput) ? rawInput : `http://${rawInput}`;
    let parsed;
    try {
      parsed = new URL(withScheme);
    } catch (error) {
      throw new Error("The local ADS-B feeder URL is invalid.");
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("The local ADS-B feeder URL must use http:// or https://.");
    }
    if (parsed.username || parsed.password) {
      throw new Error("Credentials embedded in the local feeder URL are not supported.");
    }

    parsed.hash = "";
    const explicitJson = /\.json$/i.test(parsed.pathname);
    if (explicitJson) {
      return [parsed.toString()];
    }

    const urls = [];
    const basePath = parsed.pathname.replace(/\/+$/, "");
    if (basePath) {
      const relativeCandidate = new URL(parsed.toString());
      relativeCandidate.pathname = `${basePath}/data/aircraft.json`;
      relativeCandidate.search = "";
      urls.push(relativeCandidate.toString());
    }
    DEFAULT_PATHS.forEach((path) => {
      const candidate = new URL(parsed.toString());
      candidate.pathname = path;
      candidate.search = "";
      urls.push(candidate.toString());
    });
    return [...new Set(urls)];
  }

  setCreditsUpdateCallback(callback) {
    this.onCreditsUpdate = callback;
  }

  async getAcInRange() {
    const aircraft = await this._getAllAircraft();
    return aircraft.filter((ac) => ac.dst <= this.range);
  }

  async getAc(options) {
    const aircraft = await this._getAllAircraft();
    const icao = cleanIdentifier(options.ico);
    const registration = cleanIdentifier(options.reg);
    const callsign = cleanIdentifier(options.call);
    return aircraft.filter((ac) => {
      if (icao) return cleanIdentifier(ac.icao) === icao;
      if (registration) return cleanIdentifier(ac.reg) === registration;
      if (callsign) return cleanIdentifier(ac.call) === callsign;
      return false;
    });
  }

  async _getAllAircraft() {
    const { jsonData, states, endpoint } = await this._fetchAircraftPayload();
    const responseNow = toNumber(firstDefined(jsonData.now, jsonData.ctime, jsonData.time, jsonData.stm));
    const aircraft = states
      .map((state) => this._normalizeAircraft(state, responseNow, endpoint))
      .filter((ac) => ac !== null);
    this.lastScan = responseNow || Date.now();
    return aircraft;
  }

  async _fetchAircraftPayload() {
    const candidates = this.resolvedEndpoint
      ? [this.resolvedEndpoint, ...this.candidateUrls.filter((url) => url !== this.resolvedEndpoint)]
      : this.candidateUrls;
    const errors = [];

    for (const endpoint of candidates) {
      try {
        const jsonData = await this._requestJson(endpoint);
        const states = this._extractAircraftArray(jsonData);
        if (!states) {
          throw new Error("response does not contain an aircraft, ac, or acList array");
        }
        if (this.resolvedEndpoint !== endpoint) {
          this.resolvedEndpoint = endpoint;
          console.log(`[LocalFeeder] using ${this._safeEndpointForLog(endpoint)}`);
        }
        return { jsonData, states, endpoint };
      } catch (error) {
        errors.push(`${this._safeEndpointForLog(endpoint)}: ${error.message || error}`);
        if (["ECONNREFUSED", "ENOTFOUND", "EHOSTUNREACH", "ETIMEDOUT"].includes(error.code)) {
          break;
        }
      }
    }

    this.resolvedEndpoint = null;
    throw new Error(`Unable to read the local ADS-B feeder. ${errors.join("; ")}`);
  }

  _extractAircraftArray(jsonData) {
    if (Array.isArray(jsonData)) return jsonData;
    if (!jsonData || typeof jsonData !== "object") return null;
    if (Array.isArray(jsonData.aircraft)) return jsonData.aircraft;
    if (Array.isArray(jsonData.ac)) return jsonData.ac;
    if (Array.isArray(jsonData.acList)) return jsonData.acList;
    return null;
  }

  _normalizeAircraft(state, responseNow, endpoint) {
    const lat = toNumber(firstDefined(state.lat, state.Lat, state.latitude));
    const lon = toNumber(firstDefined(state.lon, state.Long, state.longitude));
    if (lat === null || lon === null) return null;

    const altitudeFactor = this.units === "metric" ? 1 : 0.3048;
    const speedFactor = this.units === "metric" ? 1 : 1.852;
    const verticalRateFactor = this.units === "metric" ? 1 : 0.00508;
    const rawBarometricAltitude = firstDefined(state.alt_baro, state.altitude, state.alt, state.Alt);
    const isOnGround = typeof rawBarometricAltitude === "string"
      && rawBarometricAltitude.toLowerCase() === "ground";
    const rawGeometricAltitude = firstDefined(state.alt_geom, state.geom_altitude, state.galt, state.GAlt);
    const seenSeconds = toNumber(firstDefined(state.seen, state.seen_pos, state.Seen));
    const responseTimeMs = responseNow
      ? responseNow * (responseNow < 100000000000 ? 1000 : 1)
      : Date.now();
    const icao = cleanIdentifier(firstDefined(state.hex, state.icao, state.Icao, state.ModeS));
    if (!icao) return null;

    const registration = firstDefined(state.r, state.reg, state.Reg, state.Registration) || "";
    const model = firstDefined(state.desc, state.mdl, state.Mdl) || "";
    const icaoType = firstDefined(state.t, state.typeCode, state.icao_type, state.IcaoType, state.Type) || "";
    const operator = firstDefined(state.ownOp, state.op, state.OpIcao, state.OpCode, state.Op, state.operator) || "";
    const localMetadataSources = {
      registration: registration ? "localFeeder" : "",
      model: model ? "localFeeder" : "",
      icaoType: icaoType ? "localFeeder" : "",
      operator: operator ? "localFeeder" : "",
    };
    const positionSource = toBoolean(firstDefined(state.mlat, state.Mlat))
      ? "MLAT"
      : toBoolean(firstDefined(state.tisb, state.Tisb))
        ? "TIS-B"
        : "ADS-B/local feeder";
    const ac = {
      icao,
      call: cleanIdentifier(firstDefined(state.flight, state.call, state.Call, state.Callsign)),
      oc: firstDefined(state.cou, state.country, state.Cou) || "",
      posTime: responseTimeMs - (seenSeconds || 0) * 1000,
      lastSeen: responseTimeMs - (seenSeconds || 0) * 1000,
      lon,
      lat,
      bAlt: isOnGround
        ? 0
        : Math.round((toNumber(rawBarometricAltitude) || 0) * altitudeFactor),
      gnd: isOnGround
        || toBoolean(firstDefined(state.gnd, state.on_ground, state.Gnd)),
      spd: Math.round((toNumber(firstDefined(state.gs, state.speed, state.spd, state.Spd)) || 0) * speedFactor),
      brng: toNumber(firstDefined(state.track, state.trak, state.Trak)) || 0,
      vsi: Math.round((toNumber(firstDefined(state.baro_rate, state.geom_rate, state.vsi, state.Vsi)) || 0) * verticalRateFactor),
      gAlt: Math.round((toNumber(rawGeometricAltitude) || 0) * altitudeFactor),
      sqk: String(firstDefined(state.squawk, state.sqk, state.Sqk) || ""),
      spi: toBoolean(firstDefined(state.spi, state.interested, state.Interested)),
      reg: registration,
      from: firstDefined(state.from, state.From) || "N/A",
      to: firstDefined(state.to, state.To) || "N/A",
      op: operator,
      mdl: model,
      type: icaoType,
      mil: toBoolean(firstDefined(state.mil, state.Mil))
        || Boolean((toNumber(state.dbFlags) || 0) & 1),
      stateSource: "localFeeder",
      positionSource,
      metadataSource: Object.values(localMetadataSources).some(Boolean)
        ? "localFeeder"
        : "localFeeder:no-metadata",
      metadataSources: localMetadataSources,
      dataEndpoint: endpoint ? this._safeEndpointForLog(endpoint) : "",
    };

    const acLoc = new GeoPoint(ac.lat, ac.lon);
    ac.dst = Math.round(this.center.distanceTo(acLoc, true) * 1000);
    return ac;
  }

  _safeEndpointForLog(endpoint) {
    const parsed = new URL(endpoint);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  }

  _requestJson(endpoint, redirectsRemaining = 3) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(endpoint);
      const transport = parsed.protocol === "https:" ? https : http;
      const request = transport.get(parsed, {
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "identity",
          "Cache-Control": "no-cache",
          "User-Agent": "com.gruijter.virtualradar",
        },
        timeout: this.timeout,
      }, (response) => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
          response.resume();
          if (redirectsRemaining <= 0) {
            reject(new Error("too many redirects"));
            return;
          }
          const redirectUrl = new URL(response.headers.location, parsed).toString();
          this._requestJson(redirectUrl, redirectsRemaining - 1).then(resolve, reject);
          return;
        }

        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
          if (body.length > MAX_RESPONSE_SIZE) {
            request.destroy(new Error("local feeder response is too large"));
          }
        });
        response.once("end", () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`HTTP ${response.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(new Error("response is not valid JSON"));
          }
        });
      });

      request.once("timeout", () => {
        const error = new Error("request timed out");
        error.code = "ETIMEDOUT";
        request.destroy(error);
      });
      request.once("error", reject);
    });
  }
}

module.exports = LocalFeederRadar;
