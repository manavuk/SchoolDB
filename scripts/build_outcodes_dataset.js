/**
 * UK Postcodes & Outcodes Geospatial Coordinate Builder
 * Generates data/uk_outcodes_coords.json and seeds SQLite postcode_cache
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const db = require('../db');

// Mathematical converter: OSGB36 Easting/Northing to WGS84 Latitude/Longitude
function osgb36ToWgs84(e, n) {
  const a = 6377563.396, b = 6356256.909; // Airy 1830 ellipsoid
  const F0 = 0.9996012717;
  const lat0 = 49 * Math.PI / 180, lon0 = -2 * Math.PI / 180;
  const N0 = -100000, E0 = 400000;
  const e2 = 1 - (b * b) / (a * a);
  const n1 = (a - b) / (a + b), n2 = n1 * n1, n3 = n1 * n1 * n1;

  let lat = lat0, M = 0;
  let iterations = 0;
  do {
    lat = (n - N0 - M) / (a * F0) + lat;
    const Ma = (1 + n1 + (5 / 4) * n2 + (5 / 4) * n3) * (lat - lat0);
    const Mb = (3 * n1 + 3 * n2 + (21 / 8) * n3) * Math.sin(lat - lat0) * Math.cos(lat + lat0);
    const Mc = ((15 / 8) * n2 + (15 / 8) * n3) * Math.sin(2 * (lat - lat0)) * Math.cos(2 * (lat + lat0));
    const Md = (35 / 24) * n3 * Math.sin(3 * (lat - lat0)) * Math.cos(3 * (lat + lat0));
    M = b * F0 * (Ma - Mb + Mc - Md);
    iterations++;
  } while (Math.abs(n - N0 - M) >= 0.00001 && iterations < 100);

  const cosLat = Math.cos(lat), sinLat = Math.sin(lat);
  const nu = a * F0 / Math.sqrt(1 - e2 * sinLat * sinLat);
  const rho = a * F0 * (1 - e2) / Math.pow(1 - e2 * sinLat * sinLat, 1.5);
  const eta2 = nu / rho - 1;

  const tanLat = Math.tan(lat);
  const tan2lat = tanLat * tanLat, tan4lat = tan2lat * tan2lat;
  const secLat = 1 / cosLat;
  const nu3 = nu * nu * nu, nu5 = nu3 * nu * nu;
  const VII = tanLat / (2 * rho * nu);
  const VIII = tanLat / (24 * rho * nu3) * (5 + 3 * tan2lat + eta2 - 9 * tan2lat * eta2);
  const IX = tanLat / (720 * rho * nu5) * (61 + 90 * tan2lat + 45 * tan4lat);
  const X = secLat / nu;
  const XI = secLat / (6 * nu3) * (nu / rho + 2 * tan2lat);
  const XII = secLat / (120 * nu5) * (5 + 28 * tan2lat + 24 * tan4lat);

  const dE = (e - E0);
  const dE2 = dE * dE, dE3 = dE2 * dE, dE4 = dE2 * dE2, dE5 = dE3 * dE2;
  lat = lat - VII * dE2 + VIII * dE4 - IX * (dE2 * dE4);
  let lon = lon0 + X * dE - XI * dE3 + XII * dE5;

  const degLat = lat * 180 / Math.PI;
  const degLon = lon * 180 / Math.PI;

  return {
    lat: parseFloat(degLat.toFixed(6)),
    lon: parseFloat(degLon.toFixed(6))
  };
}

// Convert WGS84 Lat/Lon to OSGB36 Easting/Northing
function wgs84ToOsgb36(latDeg, lonDeg) {
  const a = 6377563.396, b = 6356256.909;
  const F0 = 0.9996012717;
  const lat0 = 49 * Math.PI / 180, lon0 = -2 * Math.PI / 180;
  const N0 = -100000, E0 = 400000;
  const e2 = 1 - (b * b) / (a * a);
  const n = (a - b) / (a + b), n2 = n * n, n3 = n * n * n;

  const lat = latDeg * Math.PI / 180;
  const lon = lonDeg * Math.PI / 180;

  const cosLat = Math.cos(lat), sinLat = Math.sin(lat);
  const nu = a * F0 / Math.sqrt(1 - e2 * sinLat * sinLat);
  const rho = a * F0 * (1 - e2) / Math.pow(1 - e2 * sinLat * sinLat, 1.5);
  const eta2 = nu / rho - 1;

  const Ma = (1 + n + (5 / 4) * n2 + (5 / 4) * n3) * (lat - lat0);
  const Mb = (3 * n + 3 * n2 + (21 / 8) * n3) * Math.sin(lat - lat0) * Math.cos(lat + lat0);
  const Mc = ((15 / 8) * n2 + (15 / 8) * n3) * Math.sin(2 * (lat - lat0)) * Math.cos(2 * (lat + lat0));
  const Md = (35 / 24) * n3 * Math.sin(3 * (lat - lat0)) * Math.cos(3 * (lat + lat0));
  const M = b * F0 * (Ma - Mb + Mc - Md);

  const tanLat = Math.tan(lat);
  const tan2lat = tanLat * tanLat, tan4lat = tan2lat * tan2lat;
  const I = M + N0;
  const II = (nu / 2) * sinLat * cosLat;
  const III = (nu / 24) * sinLat * Math.pow(cosLat, 3) * (5 - tan2lat + 9 * eta2);
  const IIIA = (nu / 720) * sinLat * Math.pow(cosLat, 5) * (61 - 58 * tan2lat + tan4lat);
  const IV = nu * cosLat;
  const V = (nu / 6) * Math.pow(cosLat, 3) * (nu / rho - tan2lat);
  const VI = (nu / 120) * Math.pow(cosLat, 5) * (5 - 18 * tan2lat + tan4lat + 14 * eta2 - 58 * tan2lat * eta2);

  const dLon = lon - lon0;
  const dLon2 = dLon * dLon, dLon3 = dLon2 * dLon, dLon4 = dLon2 * dLon2, dLon5 = dLon3 * dLon2;

  const N = I + II * dLon2 + III * dLon4 + IIIA * (dLon2 * dLon4);
  const E = E0 + IV * dLon + V * dLon3 + VI * dLon5;

  return {
    easting: Math.round(E),
    northing: Math.round(N)
  };
}

async function buildGeospatialDatabase() {
  console.log('=== Building Geospatial UK Postcode Database & Outcodes Map ===\n');

  const sqlite = db.getDb();

  // Create postcode_cache table in SQLite if not exists
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS postcode_cache (
      postcode TEXT PRIMARY KEY,
      outcode TEXT,
      latitude REAL,
      longitude REAL,
      easting REAL,
      northing REAL,
      admin_district TEXT,
      source TEXT,
      created_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_postcode_cache_outcode ON postcode_cache(outcode);
  `);

  const insertPostcodeStmt = sqlite.prepare(`
    INSERT OR REPLACE INTO postcode_cache (
      postcode, outcode, latitude, longitude, easting, northing, admin_district, source, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const outcodesMap = {};
  const resultsCsvPath = path.join(__dirname, '../archive/data/results.csv');

  let parsedCount = 0;
  let insertedCacheCount = 0;

  if (fs.existsSync(resultsCsvPath)) {
    console.log('[1. Reading DfE results.csv establishment coordinates]');
    const rl = readline.createInterface({
      input: fs.createReadStream(resultsCsvPath),
      crlfDelay: Infinity
    });

    let header = null;
    let pIndex = -1, eIndex = -1, nIndex = -1, laIndex = -1;

    sqlite.exec('BEGIN TRANSACTION');
    try {
      for await (const line of rl) {
        const parts = line.split(/,(?=(?:(?:[^\"]*\"){2})*[^\"]*$)/);
        if (!header) {
          header = parts.map(p => p.replace(/\"/g, '').trim());
          pIndex = header.indexOf('Postcode');
          eIndex = header.indexOf('Easting');
          nIndex = header.indexOf('Northing');
          laIndex = header.indexOf('LA (name)');
          continue;
        }

        const rawPc = parts[pIndex] ? parts[pIndex].replace(/\"/g, '').trim().toUpperCase() : '';
        const easting = parts[eIndex] ? parseFloat(parts[eIndex].replace(/\"/g, '').trim()) : null;
        const northing = parts[nIndex] ? parseFloat(parts[nIndex].replace(/\"/g, '').trim()) : null;
        const laName = parts[laIndex] ? parts[laIndex].replace(/\"/g, '').trim() : '';

        if (rawPc && easting && northing && !isNaN(easting) && !isNaN(northing)) {
          parsedCount++;
          const normPc = rawPc.replace(/\s+/g, ' ');
          const outcode = normPc.split(' ')[0];

          const wgs = osgb36ToWgs84(easting, northing);

          insertPostcodeStmt.run(
            normPc,
            outcode,
            wgs.lat,
            wgs.lon,
            Math.round(easting),
            Math.round(northing),
            laName || 'England',
            'DfE GIAS Official',
            new Date().toISOString()
          );
          insertedCacheCount++;

          if (!outcodesMap[outcode]) {
            outcodesMap[outcode] = { count: 0, sumE: 0, sumN: 0, district: laName };
          }
          outcodesMap[outcode].count++;
          outcodesMap[outcode].sumE += easting;
          outcodesMap[outcode].sumN += northing;
        }
      }
      sqlite.exec('COMMIT');
    } catch (err) {
      sqlite.exec('ROLLBACK');
      throw err;
    }
    console.log(`  ✓ Inserted ${insertedCacheCount} unique full postcodes into SQLite postcode_cache.`);
  }

  // Generate Centroids for all captured outcodes
  console.log('\n[2. Generating Outcode District Centroids]');
  const outcodeCentroids = {};

  for (const [outcode, data] of Object.entries(outcodesMap)) {
    const avgE = Math.round(data.sumE / data.count);
    const avgN = Math.round(data.sumN / data.count);
    const coords = osgb36ToWgs84(avgE, avgN);
    outcodeCentroids[outcode] = {
      outcode,
      lat: coords.lat,
      lon: coords.lon,
      easting: avgE,
      northing: avgN,
      district: data.district,
      sampleSize: data.count
    };
  }

  // Supplement with major UK areas if not in results.csv
  const SUPPLEMENTAL_UK_CENTROIDS = [
    { outcode: 'SW1A', lat: 51.501, lon: -0.141, district: 'Westminster' },
    { outcode: 'W1A', lat: 51.517, lon: -0.143, district: 'Westminster' },
    { outcode: 'EC1A', lat: 51.519, lon: -0.100, district: 'City of London' },
    { outcode: 'WC1A', lat: 51.518, lon: -0.123, district: 'Camden' },
    { outcode: 'CV37', lat: 52.191, lon: -1.708, district: 'Stratford-on-Avon' },
    { outcode: 'GL51', lat: 51.898, lon: -2.102, district: 'Cheltenham' },
    { outcode: 'OX1', lat: 51.752, lon: -1.258, district: 'Oxford' },
    { outcode: 'CB2', lat: 52.188, lon: 0.124, district: 'Cambridge' },
    { outcode: 'BN2', lat: 50.825, lon: -0.117, district: 'Brighton' },
    { outcode: 'BS8', lat: 51.458, lon: -2.614, district: 'Bristol' },
    { outcode: 'M14', lat: 53.451, lon: -2.218, district: 'Manchester' },
    { outcode: 'B14', lat: 52.428, lon: -1.888, district: 'Birmingham' },
    { outcode: 'LS17', lat: 53.849, lon: -1.530, district: 'Leeds' },
    { outcode: 'NE2', lat: 54.985, lon: -1.602, district: 'Newcastle' },
    { outcode: 'SO23', lat: 51.063, lon: -1.313, district: 'Winchester' },
    { outcode: 'EX24', lat: 50.742, lon: -3.070, district: 'East Devon' },
    { outcode: 'RG1', lat: 51.454, lon: -0.968, district: 'Reading' },
    { outcode: 'CO3', lat: 51.886, lon: 0.871, district: 'Colchester' },
    { outcode: 'CM1', lat: 51.745, lon: 0.468, district: 'Chelmsford' }
  ];

  for (const supp of SUPPLEMENTAL_UK_CENTROIDS) {
    if (!outcodeCentroids[supp.outcode]) {
      const grid = wgs84ToOsgb36(supp.lat, supp.lon);
      outcodeCentroids[supp.outcode] = {
        outcode: supp.outcode,
        lat: supp.lat,
        lon: supp.lon,
        easting: grid.easting,
        northing: grid.northing,
        district: supp.district,
        sampleSize: 1
      };
    }
  }

  const outcodeKeys = Object.keys(outcodeCentroids);
  console.log(`  ✓ Built district centroid mapping for ${outcodeKeys.length} UK outcodes.`);

  // Write outcodes JSON file
  const outcodesFilePath = path.join(__dirname, '../data/uk_outcodes_coords.json');
  fs.writeFileSync(outcodesFilePath, JSON.stringify(outcodeCentroids, null, 2), 'utf8');
  console.log(`  ✓ Saved outcodes lookup database to ${outcodesFilePath}`);

  return {
    postcodesInCache: insertedCacheCount,
    outcodesCount: outcodeKeys.length
  };
}

if (require.main === module) {
  buildGeospatialDatabase()
    .then(res => {
      console.log('\n=== Geospatial Database Build Completed ===');
      console.log(`Cached Postcodes: ${res.postcodesInCache}`);
      console.log(`Outcodes in JSON: ${res.outcodesCount}`);
    })
    .catch(err => {
      console.error('Error building database:', err);
      process.exit(1);
    });
}

module.exports = {
  buildGeospatialDatabase,
  osgb36ToWgs84,
  wgs84ToOsgb36
};
