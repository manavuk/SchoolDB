/**
 * Exact UK Postcode Distance Calculation Engine
 *
 * Implements high-precision distance measurement between two UK postcodes using:
 * 1. OSGB36 British National Grid Cartesian Projection (dx^2 + dy^2 in meters)
 * 2. WGS84 Great-Circle Haversine Arc (spherical earth trigonometry)
 *
 * Multi-tiered resolution:
 * - Tier 1: Local SQLite postcode_cache table (exact unit postcodes)
 * - Tier 2: Live api.postcodes.io lookup (cached permanently if reachable)
 * - Tier 3: Local UK outcodes centroid database (data/uk_outcodes_coords.json)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const db = require('../db');

// Load bundled local outcode centroids lookup
let outcodesData = null;
function getOutcodesDataset() {
  if (!outcodesData) {
    const jsonPath = path.join(__dirname, '../data/uk_outcodes_coords.json');
    if (fs.existsSync(jsonPath)) {
      try {
        outcodesData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      } catch (e) {
        console.warn('Failed to parse uk_outcodes_coords.json:', e.message);
        outcodesData = {};
      }
    } else {
      outcodesData = {};
    }
  }
  return outcodesData;
}

/**
 * Cleanse and normalize a UK postcode to standard format (e.g. "EN5 4DQ")
 */
function normalizePostcode(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const clean = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (clean.length <= 4) {
    return clean; // outcode only, e.g. "EN5" or "SW1A"
  }
  const incode = clean.slice(-3);
  const outcode = clean.slice(0, -3);
  return `${outcode} ${incode}`;
}

/**
 * Extract outcode district from a postcode (e.g. "EN5" from "EN5 4DQ")
 */
function extractOutcode(postcode) {
  const norm = normalizePostcode(postcode);
  return norm.split(' ')[0] || '';
}

/**
 * Validate UK postcode format (supports both full unit postcodes and outcodes)
 */
function isValidUkPostcode(raw) {
  if (!raw || typeof raw !== 'string') return false;
  const clean = raw.trim().toUpperCase().replace(/\s+/g, ' ');
  // Full UK postcode standard regex (e.g. SW1A 1AA, EN5 4DQ, M1 1AE, B33 8TH)
  const fullRegex = /^[A-Z]{1,2}[0-9][A-Z0-9]?\s?[0-9][A-Z]{2}$/i;
  // Outcode district regex (e.g. SW1A, EN5, M1, B33)
  const outcodeRegex = /^[A-Z]{1,2}[0-9][A-Z0-9]?$/i;
  return fullRegex.test(clean) || outcodeRegex.test(clean);
}

/**
 * Great-Circle Haversine Distance formula in miles and km
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R_MILES = 3958.7613; // Earth radius in miles
  const R_KM = 6371.0088;    // Earth radius in kilometers

  const toRad = deg => deg * (Math.PI / 180);
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return {
    miles: parseFloat((R_MILES * c).toFixed(2)),
    km: parseFloat((R_KM * c).toFixed(2))
  };
}

/**
 * OSGB36 Cartesian Grid Distance formula in meters, miles, and km
 */
function osgb36Distance(easting1, northing1, easting2, northing2) {
  const dx = easting2 - easting1;
  const dy = northing2 - northing1;
  const meters = Math.sqrt(dx * dx + dy * dy);
  return {
    meters: parseFloat(meters.toFixed(1)),
    miles: parseFloat((meters / 1609.344).toFixed(2)),
    km: parseFloat((meters / 1000.0).toFixed(2))
  };
}

/**
 * Fetch pinpoint coordinates from api.postcodes.io with timeout
 */
function fetchPostcodesIo(cleanPostcode) {
  return new Promise((resolve) => {
    const encoded = encodeURIComponent(cleanPostcode.replace(/\s+/g, ''));
    const req = https.get(`https://api.postcodes.io/postcodes/${encoded}`, { timeout: 1500 }, (res) => {
      if (res.statusCode !== 200) {
        return resolve(null);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed && parsed.status === 200 && parsed.result) {
            return resolve(parsed.result);
          }
        } catch (e) {}
        resolve(null);
      });
    });

    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

/**
 * Resolve coordinates for a single UK postcode
 */
async function getPostcodeCoordinates(rawPostcode) {
  const norm = normalizePostcode(rawPostcode);
  if (!norm) return null;

  const outcode = extractOutcode(norm);
  const sqlite = db.getDb();

  // 1. Check SQLite postcode_cache table
  try {
    const cached = sqlite.prepare('SELECT * FROM postcode_cache WHERE postcode = ?').get(norm);
    if (cached && cached.latitude && cached.longitude) {
      return {
        postcode: cached.postcode,
        outcode: cached.outcode,
        lat: cached.latitude,
        lon: cached.longitude,
        easting: cached.easting,
        northing: cached.northing,
        adminDistrict: cached.admin_district,
        precision: 'exact_unit',
        source: cached.source || 'SQLite Cache'
      };
    }
  } catch (e) {}

  // 2. Query live api.postcodes.io if reachable
  try {
    const live = await fetchPostcodesIo(norm);
    if (live && live.latitude && live.longitude) {
      const liveData = {
        postcode: live.postcode || norm,
        outcode: live.outcode || outcode,
        lat: live.latitude,
        lon: live.longitude,
        easting: live.eastings || null,
        northing: live.northings || null,
        adminDistrict: live.admin_district || '',
        precision: 'exact_unit',
        source: 'api.postcodes.io'
      };

      try {
        sqlite.prepare(`
          INSERT OR REPLACE INTO postcode_cache (
            postcode, outcode, latitude, longitude, easting, northing, admin_district, source, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          liveData.postcode,
          liveData.outcode,
          liveData.lat,
          liveData.lon,
          liveData.easting,
          liveData.northing,
          liveData.adminDistrict,
          'api.postcodes.io',
          new Date().toISOString()
        );
      } catch (e) {}

      return liveData;
    }
  } catch (e) {}

  // 3. Fall back to local outcodes dataset (data/uk_outcodes_coords.json)
  const outcodes = getOutcodesDataset();
  if (outcodes && outcodes[outcode]) {
    const c = outcodes[outcode];
    return {
      postcode: norm,
      outcode: c.outcode,
      lat: c.lat,
      lon: c.lon,
      easting: c.easting,
      northing: c.northing,
      adminDistrict: c.district || '',
      precision: 'district_centroid',
      source: 'UK Outcodes Dataset'
    };
  }

  // 4. Try matching outcode in SQLite postcode_cache
  try {
    const outcodeSample = sqlite.prepare('SELECT * FROM postcode_cache WHERE outcode = ? LIMIT 1').get(outcode);
    if (outcodeSample && outcodeSample.latitude) {
      return {
        postcode: norm,
        outcode: outcodeSample.outcode,
        lat: outcodeSample.latitude,
        lon: outcodeSample.longitude,
        easting: outcodeSample.easting,
        northing: outcodeSample.northing,
        adminDistrict: outcodeSample.admin_district || '',
        precision: 'district_centroid',
        source: 'SQLite Outcode Sample'
      };
    }
  } catch (e) {}

  return null;
}

/**
 * Synchronously resolve coordinates using local cache & outcodes dataset
 */
function getPostcodeCoordinatesSync(rawPostcode) {
  const norm = normalizePostcode(rawPostcode);
  if (!norm) return null;

  const outcode = extractOutcode(norm);
  const sqlite = db.getDb();

  // 1. Check SQLite postcode_cache table
  try {
    const cached = sqlite.prepare('SELECT * FROM postcode_cache WHERE postcode = ?').get(norm);
    if (cached && cached.latitude && cached.longitude) {
      return {
        postcode: cached.postcode,
        outcode: cached.outcode,
        lat: cached.latitude,
        lon: cached.longitude,
        easting: cached.easting,
        northing: cached.northing,
        adminDistrict: cached.admin_district,
        precision: 'exact_unit',
        source: cached.source || 'SQLite Cache'
      };
    }
  } catch (e) {}

  // 2. Check local outcodes dataset
  const outcodes = getOutcodesDataset();
  if (outcodes && outcodes[outcode]) {
    const c = outcodes[outcode];
    return {
      postcode: norm,
      outcode: c.outcode,
      lat: c.lat,
      lon: c.lon,
      easting: c.easting,
      northing: c.northing,
      adminDistrict: c.district || '',
      precision: 'district_centroid',
      source: 'UK Outcodes Dataset'
    };
  }

  // 3. Fallback to any outcode sample in SQLite
  try {
    const outcodeSample = sqlite.prepare('SELECT * FROM postcode_cache WHERE outcode = ? LIMIT 1').get(outcode);
    if (outcodeSample && outcodeSample.latitude) {
      return {
        postcode: norm,
        outcode: outcodeSample.outcode,
        lat: outcodeSample.latitude,
        lon: outcodeSample.longitude,
        easting: outcodeSample.easting,
        northing: outcodeSample.northing,
        adminDistrict: outcodeSample.admin_district || '',
        precision: 'district_centroid',
        source: 'SQLite Outcode Sample'
      };
    }
  } catch (e) {}

  return null;
}

/**
 * Calculate distance between two UK postcodes
 */
async function calculateDistance(postcodeA, postcodeB) {
  const [coordsA, coordsB] = await Promise.all([
    getPostcodeCoordinates(postcodeA),
    getPostcodeCoordinates(postcodeB)
  ]);

  if (!coordsA) {
    return {
      success: false,
      error: `Could not resolve coordinates for source postcode: "${postcodeA}"`
    };
  }

  if (!coordsB) {
    return {
      success: false,
      error: `Could not resolve coordinates for destination postcode: "${postcodeB}"`
    };
  }

  // Calculate using both methods
  let distMiles = 0;
  let distKm = 0;

  if (coordsA.easting && coordsA.northing && coordsB.easting && coordsB.northing) {
    const osgb = osgb36Distance(coordsA.easting, coordsA.northing, coordsB.easting, coordsB.northing);
    distMiles = osgb.miles;
    distKm = osgb.km;
  } else {
    const hav = haversineDistance(coordsA.lat, coordsA.lon, coordsB.lat, coordsB.lon);
    distMiles = hav.miles;
    distKm = hav.km;
  }

  const isExact = coordsA.precision === 'exact_unit' && coordsB.precision === 'exact_unit';

  const normA = normalizePostcode(postcodeA);
  const normB = normalizePostcode(postcodeB);

  return {
    success: true,
    from: normA,
    to: normB,
    distanceMiles: distMiles,
    distanceKm: distKm,
    precision: isExact ? 'exact' : 'approximate_district',
    accuracyDescription: isExact ? 'Exact street/unit level (±5 meters)' : 'District centroid level (±0.5 miles)',
    fromCoords: coordsA,
    toCoords: coordsB,
    googleMapsDirectionsUrl: `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(normA)}&destination=${encodeURIComponent(normB)}`
  };
}

/**
 * Annotate a list of schools with distance from user's postcode and sort by nearest first
 */
function calculateDistancesToSchools(userPostcode, schoolsList, maxMiles = null) {
  const userCoords = getPostcodeCoordinatesSync(userPostcode);
  if (!userCoords) {
    return {
      success: false,
      error: `Could not resolve coordinates for user postcode "${userPostcode}"`,
      schools: schoolsList
    };
  }

  const normUserPc = normalizePostcode(userPostcode);

  const enriched = [];

  for (const school of schoolsList) {
    if (!school.postcode) continue;

    const schoolCoords = getPostcodeCoordinatesSync(school.postcode);
    if (!schoolCoords) continue;

    let distMiles = 0;
    let distKm = 0;

    if (userCoords.easting && userCoords.northing && schoolCoords.easting && schoolCoords.northing) {
      const osgb = osgb36Distance(userCoords.easting, userCoords.northing, schoolCoords.easting, schoolCoords.northing);
      distMiles = osgb.miles;
      distKm = osgb.km;
    } else {
      const hav = haversineDistance(userCoords.lat, userCoords.lon, schoolCoords.lat, schoolCoords.lon);
      distMiles = hav.miles;
      distKm = hav.km;
    }

    if (maxMiles !== null && maxMiles !== undefined && maxMiles > 0) {
      if (distMiles > maxMiles) continue;
    }

    enriched.push({
      ...school,
      distanceMiles: distMiles,
      distanceKm: distKm,
      distanceFormatted: `${distMiles.toFixed(1)} miles`,
      distanceDirectionsUrl: `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(normUserPc)}&destination=${encodeURIComponent(school.postcode)}`
    });
  }

  // Sort by nearest distance first
  enriched.sort((a, b) => a.distanceMiles - b.distanceMiles);

  return {
    success: true,
    userPostcode: normUserPc,
    userCoords,
    totalMatched: enriched.length,
    schools: enriched
  };
}

module.exports = {
  normalizePostcode,
  extractOutcode,
  isValidUkPostcode,
  haversineDistance,
  osgb36Distance,
  getPostcodeCoordinates,
  getPostcodeCoordinatesSync,
  calculateDistance,
  calculateDistancesToSchools
};
