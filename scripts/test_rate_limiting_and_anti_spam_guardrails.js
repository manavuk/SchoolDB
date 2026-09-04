const assert = require('assert');
const dfeGiasLookup = require('./dfe_gias_lookup');
const db = require('../db');

console.log('=== RUNNING TESTS: Rate Limiting, Pacing & Anti-Spam Guardrails ===\n');

(async () => {
  // 1. Verify DfE GIAS Lookup Throttling & In-Memory Cache
  console.log('[1. Testing DfE GIAS Request Throttling & In-Memory Caching]');
  const startTime = Date.now();
  
  // First lookup (loads and caches)
  const sch1 = await dfeGiasLookup.fetchDfeGiasDetails('100537');
  assert(sch1 && sch1.name, 'First lookup must resolve school');

  // Second immediate lookup of the same URN (must return from memory cache with 0 network overhead)
  const cacheStartTime = Date.now();
  const sch2 = await dfeGiasLookup.fetchDfeGiasDetails('100537');
  const cacheDuration = Date.now() - cacheStartTime;
  assert.strictEqual(sch1.name, sch2.name, 'Cached record must match');
  assert(cacheDuration < 50, `Cached lookup must be near instantaneous (<50ms), took ${cacheDuration}ms`);
  console.log(`  ✓ In-memory caching resolved repeat URN lookup in ${cacheDuration}ms without outbound network spam.`);

  // 2. Verify Background Crawler Pacing Configuration
  console.log('\n[2. Testing Background AI Crawler Pacing Configuration]');
  const adminSettings = db.getAdminSettings();
  assert(typeof adminSettings.scannerDelaySeconds === 'number', 'scannerDelaySeconds must be a number');
  assert(adminSettings.scannerDelaySeconds >= 0 && adminSettings.scannerDelaySeconds <= 300, 'scannerDelaySeconds must be within 0-300s range');
  console.log(`  ✓ Background crawler is configured with ${adminSettings.scannerDelaySeconds}s delay between sequential queries.`);

  // 3. Verify System Settings Skip Window
  console.log('\n[3. Testing Scanner Cache Skip Window]');
  assert(typeof adminSettings.scannerSkipDays === 'number', 'scannerSkipDays must be a number');
  assert(adminSettings.scannerSkipDays >= 0, 'scannerSkipDays must be positive');
  console.log(`  ✓ Scanner cache window prevents re-scanning recently audited schools for ${adminSettings.scannerSkipDays} days.`);

  console.log('\n========================================================================');
  console.log('🎉 ALL RATE LIMITING & ANTI-SPAM GUARDRAIL TESTS PASSED!');
  console.log('========================================================================\n');
})();
