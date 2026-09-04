/**
 * Verification Test Suite: Manual Trigger & Persistence for Deduplication & Conflict Scans
 */
const assert = require('assert');
const db = require('../db');
const { findGenuineDuplicatesAndRoute } = require('./deduplication_engine');

async function runTests() {
  console.log('🧪 Starting Manual Scan & Persistence Verification Test Suite...\n');

  // 1. Verify db.getQualityScanResult and db.saveQualityScanResult
  console.log('1. Testing data_quality_scans table storage...');
  
  const testPayload = {
    candidatePairs: [{ pairId: 'test-1::test-2', reason: 'Test duplicate' }],
    correctionsQueue: [{ pairId: 'test-3::test-4', reason: 'Conflicting URN' }],
    enrichmentQueue: []
  };

  const saved = db.saveQualityScanResult('deduplication_audit', testPayload, 6489);
  assert.strictEqual(saved.scanType, 'deduplication_audit');
  assert.strictEqual(typeof saved.scannedAt, 'string');
  assert.strictEqual(saved.totalSchools, 6489);

  const retrieved = db.getQualityScanResult('deduplication_audit');
  assert(retrieved !== null, 'Should retrieve persisted scan record');
  assert.strictEqual(retrieved.scannedAt, saved.scannedAt);
  assert.strictEqual(retrieved.totalSchools, 6489);
  assert.strictEqual(retrieved.data.candidatePairs.length, 1);
  assert.strictEqual(retrieved.data.correctionsQueue.length, 1);
  console.log('   ✅ Persistence table stored and retrieved scan data accurately.');

  // 2. Test manual full scan execution and repopulation
  console.log('2. Testing manual scan execution & cache refresh...');
  const allSchools = db.getAllSchools();
  const scanResult = findGenuineDuplicatesAndRoute();

  const refreshed = db.saveQualityScanResult('deduplication_audit', {
    candidatePairs: scanResult.genuineDuplicates,
    correctionsQueue: scanResult.correctionsQueue,
    enrichmentQueue: scanResult.enrichmentQueue
  }, allSchools.length);

  assert(refreshed.scannedAt !== undefined);
  const reloaded = db.getQualityScanResult('deduplication_audit');
  assert.strictEqual(reloaded.totalSchools, allSchools.length);
  assert(Array.isArray(reloaded.data.correctionsQueue));
  assert(Array.isArray(reloaded.data.candidatePairs));
  console.log(`   ✅ Manual scan repopulated: ${reloaded.data.candidatePairs.length} duplicates, ${reloaded.data.correctionsQueue.length} conflicts.`);

  // 3. Fast read verification
  console.log('3. Verifying fast read (zero duplicate scan invocations)...');
  const t0 = Date.now();
  const fastRead = db.getQualityScanResult('deduplication_audit');
  const t1 = Date.now();
  assert(t1 - t0 < 50, 'Reading persisted scan from SQLite must be virtually instantaneous (<50ms)');
  assert.strictEqual(fastRead.data.correctionsQueue.length, scanResult.correctionsQueue.length);
  console.log(`   ✅ Read persisted records in ${t1 - t0}ms without triggering scan.`);

  console.log('\n🎉 ALL SCAN PERSISTENCE AND MANUAL TRIGGER TESTS PASSED!\n');
}

runTests().catch(err => {
  console.error('❌ Test error:', err);
  process.exit(1);
});
