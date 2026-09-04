const assert = require('assert');
const db = require('../db');
const { syncTopRankings, getTopRankingsStatus } = require('./update_top_rankings');

console.log('=== TEST SUITE: Top 500 Rankings Expansion with Top 100 Preservation ===\n');

async function runTests() {
  const sqlite = db.getDb();

  // Step 1: Capture snapshot of current Top 100 schools
  console.log('[1. Capturing Snapshot of Existing Top 100 Schools]');
  const initialTop100 = sqlite.prepare(`
    SELECT id, name, postcode, gcse_rank_england, a_level_rank_england, national_rank_england
    FROM schools
    WHERE (gcse_rank_england IS NOT NULL AND gcse_rank_england <= 100)
       OR (a_level_rank_england IS NOT NULL AND a_level_rank_england <= 100)
       OR (national_rank_england IS NOT NULL AND national_rank_england <= 100)
  `).all();

  console.log(`  - Found ${initialTop100.length} schools currently holding Top 100 rankings in database.`);
  assert(initialTop100.length >= 100, `Must have at least 100 existing top schools before running test (found ${initialTop100.length})`);

  const qeInitial = sqlite.prepare("SELECT * FROM schools WHERE name LIKE '%Queen Elizabeth%' AND postcode = 'EN5 4DQ'").get();
  const spgsInitial = sqlite.prepare("SELECT * FROM schools WHERE id = 'sch-021'").get();
  const hbsInitial = sqlite.prepare("SELECT * FROM schools WHERE postcode = 'NW11 7BN'").get();

  assert.strictEqual(qeInitial.gcse_rank_england, 1, 'QE Barnet must be GCSE #1');
  assert.strictEqual(spgsInitial.gcse_rank_england, 1, 'St Pauls Girls must be GCSE #1');
  assert.strictEqual(hbsInitial.gcse_rank_england, 2, 'Henrietta Barnett must be GCSE #2');
  console.log('  ✓ Verified key top schools in pre-update snapshot.');

  // Step 2: Execute Top 500 Synchronizer with preserveTop100: true
  console.log('\n[2. Executing Top 500 Sync with preserveTop100 = true]');
  const syncResult = syncTopRankings({ maxRank: 500, preserveTop100: true });

  console.log(`  - Preserved Top 100 schools: ${syncResult.preservedTop100Count}`);
  console.log(`  - Newly updated schools (101 to 500): ${syncResult.newlyRankedCount}`);

  assert(syncResult.preservedTop100Count >= 100, 'Preserved count must be at least 100');
  assert(syncResult.newlyRankedCount >= 300, `Newly ranked count must be at least 300 (got ${syncResult.newlyRankedCount})`);
  console.log('  ✓ Synchronizer ran successfully.');

  // Step 3: Verify strict preservation of Top 100 data
  console.log('\n[3. Verifying Strict Preservation of Existing Top 100 Schools]');
  for (const orig of initialTop100) {
    const after = sqlite.prepare('SELECT id, name, gcse_rank_england, a_level_rank_england, national_rank_england FROM schools WHERE id = ?').get(orig.id);
    assert(after, `School ${orig.name} (${orig.id}) must still exist`);
    assert.strictEqual(after.gcse_rank_england, orig.gcse_rank_england, `GCSE rank for ${orig.name} must remain unchanged (${orig.gcse_rank_england} vs ${after.gcse_rank_england})`);
    assert.strictEqual(after.a_level_rank_england, orig.a_level_rank_england, `A-Level rank for ${orig.name} must remain unchanged (${orig.a_level_rank_england} vs ${after.a_level_rank_england})`);
    assert.strictEqual(after.national_rank_england, orig.national_rank_england, `National rank for ${orig.name} must remain unchanged (${orig.national_rank_england} vs ${after.national_rank_england})`);
  }
  console.log(`  ✓ 100% of the ${initialTop100.length} Top 100 schools retained their exact identical rankings without any modification.`);

  // Step 4: Verify expanded database status for Top 500
  console.log('\n[4. Verifying Expanded Top 500 Database Status]');
  const status = getTopRankingsStatus(500);
  console.log(`  - GCSE <= 100 count: ${status.totalTop100Gcse}`);
  console.log(`  - A-Level <= 100 count: ${status.totalTop100ALevel}`);
  console.log(`  - Total GCSE <= 500 in DB: ${status.totalGcseRanked}`);
  console.log(`  - Total A-Level <= 500 in DB: ${status.totalALevelRanked}`);
  console.log(`  - Total National <= 500 in DB: ${status.totalNationalRanked}`);

  assert(status.totalGcseRanked >= 500, `Total GCSE ranked <= 500 must be >= 500 (got ${status.totalGcseRanked})`);
  assert(status.totalALevelRanked >= 500, `Total A-Level ranked <= 500 must be >= 500 (got ${status.totalALevelRanked})`);
  assert(status.totalNationalRanked >= 500, `Total National ranked <= 500 must be >= 500 (got ${status.totalNationalRanked})`);
  console.log('  ✓ SQLite database successfully populated with Top 500 rankings.');

  // Step 5: Spot Check Ranks in the 101 to 500 Range
  console.log('\n[5. Spot Checking Ranks 101 to 500]');
  const rank101 = sqlite.prepare('SELECT id, name, schoolType, gcse_rank_england, national_rank_england FROM schools WHERE national_rank_england = 101').get();
  assert(rank101, 'School with National Rank 101 must exist');
  console.log(`  - National #101: ${rank101.name} (${rank101.schoolType}, GCSE: #${rank101.gcse_rank_england})`);

  const rank250 = sqlite.prepare('SELECT id, name, schoolType, gcse_rank_england, national_rank_england FROM schools WHERE national_rank_england = 250').get();
  assert(rank250, 'School with National Rank 250 must exist');
  console.log(`  - National #250: ${rank250.name} (${rank250.schoolType}, GCSE: #${rank250.gcse_rank_england})`);

  const rank500 = sqlite.prepare('SELECT id, name, schoolType, gcse_rank_england, national_rank_england FROM schools WHERE national_rank_england = 500').get();
  assert(rank500, 'School with National Rank 500 must exist');
  console.log(`  - National #500: ${rank500.name} (${rank500.schoolType}, GCSE: #${rank500.gcse_rank_england})`);

  console.log('\n=== ALL TOP 500 EXPANSION & PRESERVATION TESTS PASSED SUCCESSFULLY ===');
}

runTests().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
