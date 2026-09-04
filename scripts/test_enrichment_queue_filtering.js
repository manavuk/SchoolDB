/**
 * Verification Test: Data Enrichment Queue Filtering (Excludes Already & Recently Enriched Schools)
 */
const assert = require('assert');
const db = require('../db');

async function runTests() {
  console.log('🧪 Starting Data Enrichment Queue Filtering Test Suite...\n');

  // 1. Test getSchoolsForScannerBatch with forceRerun = false (Default)
  console.log('1. Testing getSchoolsForScannerBatch excludes already enriched schools (forceRerun = false)...');
  const batchNormal = db.getSchoolsForScannerBatch('ALL', 50, 10, false);
  assert(Array.isArray(batchNormal), 'Must return an array');
  assert(batchNormal.length > 0, 'Should find un-enriched schools across database');

  for (const s of batchNormal) {
    assert.notStrictEqual(s.verification_status, 'llm_enriched', `School ${s.name} has verification_status='llm_enriched' and must NOT be in queue`);
    if (s.verification_tags) {
      const tags = typeof s.verification_tags === 'string' ? JSON.parse(s.verification_tags) : s.verification_tags;
      assert(!tags.includes('llm_enriched'), `School ${s.name} has 'llm_enriched' tag and must NOT be in queue`);
      assert(!tags.includes('llm_verified'), `School ${s.name} has 'llm_verified' tag and must NOT be in queue`);
    }
    if (s.verified_at) {
      const ageMs = Date.now() - new Date(s.verified_at).getTime();
      const tenDaysMs = 10 * 24 * 60 * 60 * 1000;
      assert(ageMs >= tenDaysMs, `School ${s.name} was verified within cache window (${s.verified_at}) and must NOT be in queue`);
    }
  }
  console.log(`   ✅ Successfully validated ${batchNormal.length} queued schools: 0 are already enriched or recently verified.`);

  // 2. Test specific categories (ALL_INDEPENDENT, STATE_COMPREHENSIVE, UNVERIFIED)
  console.log('2. Testing specific categories with un-enriched filter...');
  for (const cat of ['ALL_INDEPENDENT', 'STATE_COMPREHENSIVE', 'UNVERIFIED']) {
    const catBatch = db.getSchoolsForScannerBatch(cat, 20, 10, false);
    for (const s of catBatch) {
      assert.notStrictEqual(s.verification_status, 'llm_enriched');
      if (s.verification_tags) {
        const tags = typeof s.verification_tags === 'string' ? JSON.parse(s.verification_tags) : s.verification_tags;
        assert(!tags.includes('llm_enriched'));
      }
    }
    console.log(`   ✅ Category '${cat}': Retrieved ${catBatch.length} strictly un-enriched schools.`);
  }

  // 3. Test forceRerun = true (Allows re-enrichment when explicitly requested)
  console.log('3. Testing forceRerun = true allows re-audit of enriched schools...');
  const batchForce = db.getSchoolsForScannerBatch('ALL', 20, null, true);
  assert(Array.isArray(batchForce), 'Must return an array');
  assert(batchForce.length > 0, 'Must return schools for force rerun');
  console.log(`   ✅ Force rerun successfully permits scanning of ${batchForce.length} schools.`);

  // 4. Test fully enriched category handling
  console.log('4. Testing fully enriched category handling (LONDON_INDEPENDENT)...');
  const londonBatch = db.getSchoolsForScannerBatch('LONDON_INDEPENDENT', 25, 10, false);
  console.log(`   Eligible un-enriched schools in LONDON_INDEPENDENT: ${londonBatch.length}`);
  // If 0, ensures system knows all are enriched
  if (londonBatch.length === 0) {
    console.log('   ✅ Correctly detected 0 un-enriched schools in fully enriched category.');
  }

  console.log('\n🎉 ALL ENRICHMENT QUEUE FILTERING TESTS PASSED SUCCESSFULLY!\n');
}

runTests().catch(err => {
  console.error('❌ Test error:', err);
  process.exit(1);
});
