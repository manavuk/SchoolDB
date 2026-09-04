/**
 * Verification Test Suite: Reviewed Duplicate Pairs (Avoid Future Detection)
 */
const assert = require('assert');
const db = require('../db');
const { findGenuineDuplicatesAndRoute } = require('./deduplication_engine');

async function runTests() {
  console.log('🧪 Starting Reviewed Duplicate Pairs Test Suite...\n');

  // 1. Initial scan: Find genuine duplicates
  console.log('1. Running initial deduplication scan...');
  let initialScan = findGenuineDuplicatesAndRoute();
  console.log(`   Initial duplicates found: ${initialScan.genuineDuplicates.length}`);

  // If all pairs were already marked as reviewed by previous tests/actions, unmark one temporarily
  let restoredPairId = null;
  if (initialScan.genuineDuplicates.length === 0) {
    const existing = db.getReviewedDuplicatePairs();
    if (existing.length > 0) {
      restoredPairId = existing[0].pair_id;
      db.unmarkDuplicatePairReviewed(restoredPairId);
      initialScan = findGenuineDuplicatesAndRoute();
    }
  }

  assert(initialScan.genuineDuplicates.length > 0, 'Should find at least one candidate pair');

  const testPair = initialScan.genuineDuplicates[0];
  const schoolA = testPair.schoolA;
  const schoolB = testPair.schoolB;
  const canonicalKey = [schoolA.id, schoolB.id].sort().join('::');
  console.log(`   Selected test candidate pair: ${schoolA.name} (${schoolA.id}) vs ${schoolB.name} (${schoolB.id})`);

  // 2. Mark pair as reviewed
  console.log('2. Marking candidate pair as reviewed (not duplicate)...');
  const markResult = db.markDuplicatePairReviewed(
    schoolA.id,
    schoolB.id,
    schoolA.name,
    schoolB.name,
    'not_duplicate',
    'Confirmed distinct schools in verification test.',
    'admin@schooldb.test'
  );

  assert.strictEqual(markResult.pair_id, canonicalKey);
  assert.strictEqual(markResult.decision, 'not_duplicate');
  console.log('   ✅ Pair marked in SQLite reviewed_duplicate_pairs table.');

  // 3. Verify reviewed pair keys set
  console.log('3. Checking getReviewedDuplicatePairKeys set...');
  const keysSet = db.getReviewedDuplicatePairKeys();
  assert(keysSet.has(canonicalKey), 'Set must contain the canonical pair key');
  console.log('   ✅ Canonical key present in reviewed pair keys.');

  // 4. Run deduplication scan again: Verify pair is excluded from future detection
  console.log('4. Running subsequent scan to verify exclusion from future detection...');
  const subsequentScan = findGenuineDuplicatesAndRoute();
  const foundExcluded = subsequentScan.genuineDuplicates.some(p => {
    const k = [p.schoolA.id, p.schoolB.id].sort().join('::');
    return k === canonicalKey;
  });

  assert.strictEqual(foundExcluded, false, 'The reviewed pair MUST NOT appear in future duplicate scans');
  assert.strictEqual(subsequentScan.genuineDuplicates.length, initialScan.genuineDuplicates.length - 1);
  console.log(`   ✅ Candidate pair excluded! Duplicates count reduced from ${initialScan.genuineDuplicates.length} to ${subsequentScan.genuineDuplicates.length}.`);

  // 5. Test unmark / re-evaluate
  console.log('5. Testing unmarkDuplicatePairReviewed...');
  const unmarkResult = db.unmarkDuplicatePairReviewed(canonicalKey);
  assert.strictEqual(unmarkResult.success, true);
  assert.strictEqual(unmarkResult.deleted, true);

  const finalScan = findGenuineDuplicatesAndRoute();
  const reDetected = finalScan.genuineDuplicates.some(p => {
    const k = [p.schoolA.id, p.schoolB.id].sort().join('::');
    return k === canonicalKey;
  });
  assert.strictEqual(reDetected, true, 'Unmarked pair should now be detected again');
  console.log('   ✅ Unmarked pair was successfully restored to detection.');

  console.log('\n🎉 ALL REVIEWED DUPLICATE PAIRS TESTS PASSED SUCCESSFULLY!\n');
}

runTests().catch(err => {
  console.error('❌ Test error:', err);
  process.exit(1);
});
