/**
 * Automated Test Suite for UK Postcode Distance Calculation Engine
 */

const assert = require('assert');
const db = require('../db');
const engine = require('./postcode_distance_engine');

console.log('=== TEST SUITE: Exact UK Postcode Distance Calculation Engine ===\n');

async function runTests() {
  const sqlite = db.getDb();

  // Test 1: Postcode Normalization and Validation
  console.log('[1. Testing Postcode Normalization & Validation]');
  assert.strictEqual(engine.normalizePostcode('en54dq'), 'EN5 4DQ');
  assert.strictEqual(engine.normalizePostcode('  w6  7bs '), 'W6 7BS');
  assert.strictEqual(engine.normalizePostcode('SW1A1AA'), 'SW1A 1AA');
  assert.strictEqual(engine.normalizePostcode('sw19'), 'SW19');
  assert.strictEqual(engine.extractOutcode('EN5 4DQ'), 'EN5');
  assert.strictEqual(engine.extractOutcode('SW1A 1AA'), 'SW1A');

  assert.strictEqual(engine.isValidUkPostcode('EN5 4DQ'), true);
  assert.strictEqual(engine.isValidUkPostcode('w6 7bs'), true);
  assert.strictEqual(engine.isValidUkPostcode('SW19'), true);
  assert.strictEqual(engine.isValidUkPostcode('invalid-123'), false);
  assert.strictEqual(engine.isValidUkPostcode(''), false);
  console.log('  ✓ Postcode normalization and validation confirmed.');

  // Test 2: Database postcode_cache Integrity
  console.log('\n[2. Testing SQLite postcode_cache Integrity]');
  const countRow = sqlite.prepare('SELECT COUNT(*) as c FROM postcode_cache').get();
  console.log(`  - Total postcodes cached in SQLite: ${countRow.c}`);
  assert(countRow.c >= 3000, `Expected at least 3,000 cached postcodes, found ${countRow.c}`);

  const qeCache = sqlite.prepare('SELECT * FROM postcode_cache WHERE postcode = ?').get('EN5 4DQ');
  assert(qeCache, 'EN5 4DQ must be in postcode_cache');
  assert(qeCache.latitude > 51.5 && qeCache.latitude < 52.0, `Latitude for EN5 4DQ should be ~51.65, got ${qeCache.latitude}`);
  assert(qeCache.longitude < 0, `Longitude for EN5 4DQ should be negative (West of Greenwich), got ${qeCache.longitude}`);
  assert(qeCache.easting > 500000, `Easting for EN5 4DQ should be valid OSGB36 Easting, got ${qeCache.easting}`);
  assert(qeCache.northing > 190000, `Northing for EN5 4DQ should be valid OSGB36 Northing, got ${qeCache.northing}`);
  console.log(`  ✓ Verified EN5 4DQ cached coords: (${qeCache.latitude}, ${qeCache.longitude}), Easting: ${qeCache.easting}, Northing: ${qeCache.northing}`);

  // Test 3: Multi-Tiered Coordinate Resolution
  console.log('\n[3. Testing Multi-Tiered Coordinate Resolution]');
  const qeCoords = await engine.getPostcodeCoordinates('EN5 4DQ');
  assert(qeCoords, 'QE Barnet coordinates must resolve');
  assert.strictEqual(qeCoords.precision, 'exact_unit');

  const sw19Coords = await engine.getPostcodeCoordinates('SW19');
  assert(sw19Coords, 'SW19 outcode centroid must resolve');
  assert.strictEqual(sw19Coords.precision, 'district_centroid');
  assert(sw19Coords.lat > 51.4 && sw19Coords.lat < 51.5, `SW19 lat expected ~51.42, got ${sw19Coords.lat}`);
  console.log(`  ✓ SW19 district centroid resolved: (${sw19Coords.lat}, ${sw19Coords.lon}) in ${sw19Coords.adminDistrict}`);

  // Test 4: Distance Calculations Between Known Landmarks
  console.log('\n[4. Testing Distance Calculations Between Known Landmarks]');
  
  // Pair 1: Queen Elizabeth's Barnet (EN5 4DQ) to The Henrietta Barnett School (NW11 7BN)
  // Distance is approximately 5.1 - 5.4 miles
  const distQeToHbs = await engine.calculateDistance('EN5 4DQ', 'NW11 7BN');
  console.log(`  - EN5 4DQ (QE Barnet) -> NW11 7BN (Henrietta Barnett): ${distQeToHbs.distanceMiles} mi (${distQeToHbs.distanceKm} km)`);
  assert(distQeToHbs.success, 'Calculation must succeed');
  assert(distQeToHbs.distanceMiles >= 4.5 && distQeToHbs.distanceMiles <= 6.0, `Expected ~5.2 miles, got ${distQeToHbs.distanceMiles}`);
  assert(distQeToHbs.googleMapsDirectionsUrl.includes('google.com/maps/dir'), 'Must have Google Maps directions URL');

  // Pair 2: St Paul's Girls' School (W6 7BS) to King's College Wimbledon (SW19 4TT)
  // Distance is approximately 4.8 - 5.5 miles
  const distSpgsToKcs = await engine.calculateDistance('W6 7BS', 'SW19 4TT');
  console.log(`  - W6 7BS (St Paul's Girls) -> SW19 4TT (KCS Wimbledon): ${distSpgsToKcs.distanceMiles} mi (${distSpgsToKcs.distanceKm} km)`);
  assert(distSpgsToKcs.success, 'Calculation must succeed');
  assert(distSpgsToKcs.distanceMiles >= 4.5 && distSpgsToKcs.distanceMiles <= 6.0, `Expected ~5.1 miles, got ${distSpgsToKcs.distanceMiles}`);

  // Pair 3: Zero distance for identical postcodes
  const distSame = await engine.calculateDistance('EN5 4DQ', 'EN5 4DQ');
  assert.strictEqual(distSame.distanceMiles, 0, 'Distance between identical postcodes must be 0');
  console.log('  ✓ Verified identity distance is 0.00 miles.');

  // Test 5: Batch School Distance Calculation & Radius Filtering
  console.log('\n[5. Testing Batch School Distance Calculation & Radius Filtering]');
  const allSchools = db.getAllSchools();
  assert(allSchools.length > 0, 'Schools list must not be empty');

  const nearbyResult = engine.calculateDistancesToSchools('SW19 4TT', allSchools, 5); // 5 miles from Wimbledon
  assert(nearbyResult.success, 'Batch distance calculation must succeed');
  console.log(`  - Found ${nearbyResult.schools.length} schools within 5 miles of SW19 4TT (Wimbledon)`);
  assert(nearbyResult.schools.length > 5, 'Should find multiple schools in 5-mile radius in South West London');

  // Verify sorting order: nearest first
  for (let i = 0; i < nearbyResult.schools.length - 1; i++) {
    assert(
      nearbyResult.schools[i].distanceMiles <= nearbyResult.schools[i + 1].distanceMiles,
      `Schools must be sorted nearest first (${nearbyResult.schools[i].distanceMiles} <= ${nearbyResult.schools[i + 1].distanceMiles})`
    );
  }
  console.log(`  ✓ Confirmed nearest school: "${nearbyResult.schools[0].name}" at ${nearbyResult.schools[0].distanceFormatted}`);
  console.log(`  ✓ Confirmed farthest school in 5mi radius: "${nearbyResult.schools[nearbyResult.schools.length - 1].name}" at ${nearbyResult.schools[nearbyResult.schools.length - 1].distanceFormatted}`);

  // Test 6: Invalid Postcode Handling
  console.log('\n[6. Testing Invalid Postcode Handling]');
  const invalidResult = await engine.calculateDistance('ZZ99 9ZZ', 'EN5 4DQ');
  assert.strictEqual(invalidResult.success, false, 'Invalid postcode must fail gracefully');
  assert(invalidResult.error.includes('Could not resolve coordinates'), 'Error message must be descriptive');
  console.log('  ✓ Graceful error handling for invalid postcodes confirmed.');

  console.log('\n=== ALL POSTCODE DISTANCE TESTS PASSED SUCCESSFULLY ===');
}

runTests().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
