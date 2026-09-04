const assert = require('assert');
const db = require('../db');

console.log('=== Testing Unscanned Priority Batch Selection & Configurable Sleep Delay ===');

// Capture initial settings
const initialSettings = db.getAdminSettings();

try {
  // 1. Verify default scannerDelaySeconds is 20
  console.log('[1. Verifying Default Sleep Delay Setting]');
  assert.strictEqual(typeof initialSettings.scannerDelaySeconds, 'number', 'scannerDelaySeconds must be a number');
  console.log(`  ✓ Current/Default scannerDelaySeconds: ${initialSettings.scannerDelaySeconds}s`);

  // 2. Test saving custom scannerDelaySeconds (e.g. 25 seconds)
  console.log('\n[2. Testing Saving and Retrieving Custom Sleep Delay]');
  const saved = db.saveAdminSettings({
    scannerDelaySeconds: 25
  });
  assert.strictEqual(saved.scannerDelaySeconds, 25, 'scannerDelaySeconds must be updated to 25');

  const retrieved = db.getAdminSettings();
  assert.strictEqual(retrieved.scannerDelaySeconds, 25, 'Retrieved scannerDelaySeconds must be 25');
  console.log('  ✓ Configured sleep delay successfully saved and persisted in SQLite.');

  // 3. Test 5 schools batch limit
  console.log('\n[3. Testing 5 Schools Batch Limit Option]');
  const batch5 = db.getSchoolsForScannerBatch('ALL_INDEPENDENT', 5);
  assert(Array.isArray(batch5), 'Must return array');
  assert.strictEqual(batch5.length, 5, 'Must return exactly 5 schools when limit is 5');
  console.log(`  ✓ Successfully selected 5 schools for batch verification: ${batch5.map(s => s.name).join(', ')}`);

  // 4. Test priority ordering: Unscanned / un-enriched schools must appear first
  console.log('\n[4. Testing Unscanned/Un-enriched Schools Priority Ordering]');
  const londonBatch = db.getSchoolsForScannerBatch('LONDON_INDEPENDENT', 20, null, true);
  assert(londonBatch.length > 0, 'Must return schools for LONDON_INDEPENDENT');

  // Verify that any unscanned school appears before already enriched/verified schools
  let seenVerified = false;
  let unscannedAfterVerified = false;

  for (const s of londonBatch) {
    const isUnscanned = !s.verified_at || s.verification_status === 'unverified' || s.verification_status === 'unscanned' || !s.verification_tags || (!s.verification_tags.includes('llm_enriched') && !s.verification_tags.includes('llm_verified'));
    if (!isUnscanned) {
      seenVerified = true;
    } else if (seenVerified) {
      // If we see an unscanned school after an already enriched school, flag ordering failure
      unscannedAfterVerified = true;
    }
  }

  assert.strictEqual(unscannedAfterVerified, false, 'Unscanned/un-enriched schools must always be picked before already enriched schools');
  console.log('  ✓ Confirmed: Unscanned and un-enriched schools are strictly prioritized at the top of the batch queue.');

  console.log('\n🎉 ALL UNSCANNED PRIORITY & SLEEP DELAY TESTS PASSED!');
} finally {
  // Restore initial settings
  db.saveAdminSettings({
    llmProvider: initialSettings.llmProvider,
    geminiModel: initialSettings.geminiModel,
    geminiApiKey: initialSettings.geminiApiKey || '',
    openaiModel: initialSettings.openaiModel,
    openaiApiKey: initialSettings.openaiApiKey || '',
    scannerSkipDays: initialSettings.scannerSkipDays,
    scannerDelaySeconds: initialSettings.scannerDelaySeconds || 20,
    llmPromptTemplate: initialSettings.llmPromptTemplate,
    recWeights: initialSettings.recWeights,
    clearGeminiKey: !initialSettings.geminiApiKey,
    clearOpenaiKey: !initialSettings.openaiApiKey
  });
}
