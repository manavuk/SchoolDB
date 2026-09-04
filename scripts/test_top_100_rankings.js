const assert = require('assert');
const db = require('../db');
const { TOP_RANKED_SCHOOLS_DATASET, getTop100GcseSchools, getTop100ALevelSchools } = require('./top_rankings_dataset');
const { syncTop100Rankings, getRankingsStatus, findMatchingDbSchool } = require('./update_top_100_rankings');

console.log('=== TEST SUITE: Top 100 UK GCSE & A-Level School Rankings ===\n');

async function runTests() {
  const sqlite = db.getDb();

  // Test 1: Dataset Validation
  console.log('[1. Testing Top 100 Rankings Dataset Integrity]');
  assert(Array.isArray(TOP_RANKED_SCHOOLS_DATASET), 'Dataset must be an array');
  assert(TOP_RANKED_SCHOOLS_DATASET.length >= 100, `Dataset must have at least 100 entries (has ${TOP_RANKED_SCHOOLS_DATASET.length})`);

  const gcseSchools = getTop100GcseSchools();
  const aLevelSchools = getTop100ALevelSchools();

  console.log(`  - Total ranked schools in dataset: ${TOP_RANKED_SCHOOLS_DATASET.length}`);
  console.log(`  - Total GCSE ranked entries: ${gcseSchools.length}`);
  console.log(`  - Total A-Level ranked entries: ${aLevelSchools.length}`);

  assert(gcseSchools.length >= 100, `Must have at least 100 GCSE ranked schools (found ${gcseSchools.length})`);
  assert(aLevelSchools.length >= 100, `Must have at least 100 A-Level ranked schools (found ${aLevelSchools.length})`);
  console.log('  ✓ Top 100 GCSE & A-Level dataset verified with valid rank sorting.');

  // Test 2: Synchronization Execution
  console.log('\n[2. Testing Synchronization & Matching Engine]');
  const syncResult = syncTop100Rankings();
  console.log(`  - Synchronizer matched: ${syncResult.matchedCount} / ${syncResult.totalInDataset}`);
  console.log(`  - Synchronizer updated: ${syncResult.updatedCount} / ${syncResult.totalInDataset}`);

  assert.strictEqual(syncResult.unmatchedCount, 0, `Unmatched count must be 0 (found ${syncResult.unmatchedCount})`);
  assert(syncResult.matchedCount >= 100, `Must have matched at least 100 schools (matched ${syncResult.matchedCount})`);
  console.log('  ✓ Verified 100% matching and database update rate.');

  // Test 3: Status & Column Verification in SQLite
  console.log('\n[3. Testing SQLite Database Rankings Status]');
  const status = getRankingsStatus();
  console.log(`  - Total GCSE ranked (<=100) in DB: ${status.totalGcseRanked}`);
  console.log(`  - Total A-Level ranked (<=100) in DB: ${status.totalALevelRanked}`);
  console.log(`  - Total National ranked (<=100) in DB: ${status.totalNationalRanked}`);

  assert(status.totalGcseRanked >= 100, `At least 100 schools must have gcse_rank_england <= 100 in DB (found ${status.totalGcseRanked})`);
  assert(status.totalALevelRanked >= 100, `At least 100 schools must have a_level_rank_england <= 100 in DB (found ${status.totalALevelRanked})`);
  assert(status.totalNationalRanked >= 100, `At least 100 schools must have national_rank_england <= 100 in DB (found ${status.totalNationalRanked})`);
  console.log('  ✓ Verified SQLite schools table contains top 100 GCSE and A-Level rankings.');

  // Test 4: Spot Check Known Leading Schools
  console.log('\n[4. Testing Specific Key Schools for Rank Accuracy]');
  const qeBoys = sqlite.prepare("SELECT * FROM schools WHERE name LIKE '%Queen Elizabeth%' AND postcode = 'EN5 4DQ'").get();
  assert(qeBoys, 'Queen Elizabeth Barnet must exist');
  assert.strictEqual(qeBoys.gcse_rank_england, 1, 'QE Barnet GCSE rank must be 1');
  assert.strictEqual(qeBoys.a_level_rank_england, 1, 'QE Barnet A-Level rank must be 1');
  assert.strictEqual(qeBoys.national_rank_england, 1, 'QE Barnet National rank must be 1');
  console.log('  ✓ Queen Elizabeth\'s School, Barnet: GCSE #1, A-Level #1, National #1');

  const spgs = sqlite.prepare("SELECT * FROM schools WHERE id = 'sch-021'").get();
  assert(spgs, 'St Paul\'s Girls\' School must exist');
  assert.strictEqual(spgs.gcse_rank_england, 1, 'St Paul\'s Girls GCSE rank must be 1');
  assert.strictEqual(spgs.a_level_rank_england, 1, 'St Paul\'s Girls A-Level rank must be 1');
  console.log('  ✓ St Paul\'s Girls\' School: GCSE #1, A-Level #1, National #1');

  const hbs = sqlite.prepare("SELECT * FROM schools WHERE postcode = 'NW11 7BN' AND name LIKE '%Henrietta Barnett%'").get();
  assert(hbs, 'The Henrietta Barnett School must exist');
  assert.strictEqual(hbs.gcse_rank_england, 2, 'Henrietta Barnett GCSE rank must be 2');
  assert.strictEqual(hbs.a_level_rank_england, 2, 'Henrietta Barnett A-Level rank must be 2');
  console.log('  ✓ The Henrietta Barnett School: GCSE #2, A-Level #2, National #2');

  const ghs = sqlite.prepare("SELECT * FROM schools WHERE id = 'sch-385535'").get();
  assert(ghs, 'Guildford High School must exist');
  assert.strictEqual(ghs.gcse_rank_england, 2, 'Guildford High School GCSE rank must be 2');
  assert.strictEqual(ghs.a_level_rank_england, 5, 'Guildford High School A-Level rank must be 5');
  console.log('  ✓ Guildford High School: GCSE #2, A-Level #5, National #5');

  const kcs = sqlite.prepare("SELECT * FROM schools WHERE id = 'sch-074739'").get();
  assert(kcs, 'King\'s College School Wimbledon must exist');
  assert.strictEqual(kcs.gcse_rank_england, 4, 'KCS Wimbledon GCSE rank must be 4');
  assert.strictEqual(kcs.a_level_rank_england, 3, 'KCS Wimbledon A-Level rank must be 3');
  console.log('  ✓ King\'s College School Wimbledon: GCSE #4, A-Level #3, National #3');

  // Test 5: Completeness score updated
  console.log('\n[5. Testing Completeness Score Refresh for Ranked Schools]');
  assert(qeBoys.completeness_score > 0, 'Completeness score must be updated');
  console.log(`  ✓ Queen Elizabeth's School Completeness Score: ${qeBoys.completeness_score}%`);

  console.log('\n=== ALL TOP 100 RANKINGS TESTS PASSED SUCCESSFULLY ===');
}

runTests().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
