const assert = require('assert');
const db = require('../db');
const scannerVerifier = require('./scanner_verifier');

console.log('=== RUNNING TESTS: Background Scanner Worker & API Endpoints ===\n');

async function runTests() {
  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}:`, err.message);
      failed++;
    }
  }

  async function asyncTest(name, fn) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}:`, err.message);
      failed++;
    }
  }

  console.log('[1. Background Batch Worker Execution]');
  await asyncTest('Processes school batch asynchronously with results persisted to SQLite', async () => {
    const schools = db.getSchoolsForScannerBatch('ALL', 3, 0);
    assert(schools.length > 0, 'Must find schools to scan');

    for (const school of schools) {
      const scanRes = await scannerVerifier.auditAndVerifySchool(school, { timeout: 3500 });
      assert(scanRes.schoolId === school.id, 'Must return same schoolId');
      assert(scanRes.status, 'Must have a verification status');
      assert(Array.isArray(scanRes.tags), 'Tags must be an array');
      
      const saved = db.saveSchoolVerificationResult(school.id, scanRes);
      assert(saved, 'Must successfully save to SQLite');
      assert(saved.verification_status, 'Must have verification_status saved in SQLite');
    }
  });

  console.log('\n[2. Fast SSL & Offline Recovery]');
  await asyncTest('Handles unreachable/invalid domains cleanly within timeout limit', async () => {
    const fakeSchool = {
      id: 'sch-test-fake',
      name: 'Nonexistent Phantom Academy',
      website: 'https://this-domain-does-not-exist-123456789.sch.uk',
      phone: '020 0000 0000',
      schoolType: 'Independent'
    };

    const startTime = Date.now();
    const scanRes = await scannerVerifier.auditAndVerifySchool(fakeSchool, { timeout: 3500 });
    const duration = Date.now() - startTime;

    assert(duration < 4500, `Must fail fast without hanging (took ${duration}ms)`);
    assert(scanRes.tags.includes('missing_website') || scanRes.tags.includes('dead_website'), 'Must tag unreachable site');
    assert(scanRes.anomalies.length > 0, 'Must record dead website anomaly');
  });

  console.log('\n[3. Database Anomaly Categorization & Reporting]');
  test('getAllDateAnomalies updates with real-time scanner statistics', () => {
    const summary = db.getAllDateAnomalies();
    assert(summary.stats, 'Stats exist');
    assert(typeof summary.stats.totalVerified === 'number', 'Verified count is number');
    assert(typeof summary.stats.totalMissingWebsites === 'number', 'Missing websites count is number');
    assert(typeof summary.stats.totalDataMissing === 'number', 'Data missing count is number');
  });

  console.log('\n[4. Configurable Scanner Skip Window (n Days)]');
  test('Persists scannerSkipDays setting with default 10 and max 100 clamp', () => {
    // Check default
    const initial = db.getSystemSettings();
    assert(typeof initial.scannerSkipDays === 'number', 'scannerSkipDays must be number');

    // Test saving custom valid value
    db.saveSystemSettings({ scannerSkipDays: 14 });
    assert.strictEqual(db.getSystemSetting('scannerSkipDays'), 14);

    // Test 0 days (scan every time)
    db.saveSystemSettings({ scannerSkipDays: 0 });
    assert.strictEqual(db.getSystemSetting('scannerSkipDays'), 0);

    // Test clamping beyond 100 days
    db.saveSystemSettings({ scannerSkipDays: 250 });
    assert.strictEqual(db.getSystemSetting('scannerSkipDays'), 100);

    // Reset back to default 10
    db.saveSystemSettings({ scannerSkipDays: 10 });
    assert.strictEqual(db.getSystemSetting('scannerSkipDays'), 10);
  });

  test('Batch query skips schools scanned in the last n days when skipDays > 0', () => {
    const batchWithSkip = db.getSchoolsForScannerBatch('LONDON_INDEPENDENT', 50, 10);
    const now = Date.now();
    const tenDaysAgo = now - 10 * 24 * 60 * 60 * 1000;

    for (const s of batchWithSkip) {
      if (s.verified_at) {
        const verifiedTime = new Date(s.verified_at).getTime();
        assert(verifiedTime < tenDaysAgo, `School ${s.name} was scanned within last 10 days and should have been skipped`);
      }
    }
  });

  test('auditAndVerifySchool skips clean verified school within skipDays and tags skip_cache_verified', async () => {
    const mockCleanSchool = {
      id: 'mock_skip_clean',
      name: 'Dulwich College',
      schoolType: 'Independent',
      website: 'https://www.dulwich.org.uk',
      verification_status: 'auto_verified',
      verification_tags: JSON.stringify(['auto_verified']),
      verified_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() // 2 days ago
    };

    const auditResult = await scannerVerifier.auditAndVerifySchool(mockCleanSchool, { skipDays: 10 });
    assert.strictEqual(auditResult.skipped, true, 'Should be skipped');
    assert.strictEqual(auditResult.skipTag, 'skip_cache_verified', 'Must have skip_cache_verified tag');
    assert(auditResult.tags.includes('skip_cache_verified'), 'Tags array must contain skip_cache_verified');
    assert(auditResult.skipReason.includes('verified clean'), 'Reason must explain clean verification skip');
  });

  test('auditAndVerifySchool skips timed out / dead school within skipDays and tags skip_cache_timeout_dead', async () => {
    const mockDeadSchool = {
      id: 'mock_skip_dead',
      name: 'Unreachable Academy',
      schoolType: 'Comprehensive',
      website: 'https://www.completely-broken-unreachable-site-xyz.org.uk',
      verification_status: 'dead_website',
      verification_tags: JSON.stringify(['dead_website']),
      verified_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString() // 1 day ago
    };

    const auditResult = await scannerVerifier.auditAndVerifySchool(mockDeadSchool, { skipDays: 10 });
    assert.strictEqual(auditResult.skipped, true, 'Should be skipped');
    assert.strictEqual(auditResult.skipTag, 'skip_cache_timeout_dead', 'Must have skip_cache_timeout_dead tag');
    assert(auditResult.tags.includes('skip_cache_timeout_dead'), 'Tags array must contain skip_cache_timeout_dead');
    assert(auditResult.skipReason.includes('timed out or was unreachable'), 'Reason must state timeout/dead skip');
  });

  test('auditAndVerifySchool bypasses skip cache when force: true or skipDays: 0', async () => {
    const mockSchool = {
      id: 'mock_skip_force',
      name: 'St Paul\'s Girls\' School',
      schoolType: 'Independent',
      website: 'https://spgs.org',
      verification_status: 'auto_verified',
      verification_tags: JSON.stringify(['auto_verified']),
      verified_at: new Date().toISOString()
    };

    // When forced, it should not skip
    const mockPageHtml = '<html><head><title>St Paul\'s Girls\' School</title></head><body>Brook Green, Hammersmith, London W6 7BS. Registration closes November 2026.</body></html>';
    const auditResult = await scannerVerifier.auditAndVerifySchool(mockSchool, {
      force: true,
      fetchFn: async () => ({ ok: true, status: 200, body: mockPageHtml })
    });

    assert.strictEqual(auditResult.skipped, undefined, 'Forced scan must not be skipped');
  });

  test('auditAndVerifySchool aborts when crawl is stuck (>3 min timeout) and tags crawl_stuck', async () => {
    const mockHangingSchool = {
      id: 'mock_hanging_school',
      name: 'Stuck Forever Academy',
      schoolType: 'Independent',
      website: 'https://www.hanging-server-infinite-loading.sch.uk'
    };

    // Simulate 3-minute timeout guard by setting maxCrawlTimeoutMs to 30ms and hanging fetchFn
    const auditResult = await scannerVerifier.auditAndVerifySchool(mockHangingSchool, {
      maxCrawlTimeoutMs: 30,
      fetchFn: () => new Promise(r => setTimeout(() => r({ ok: true, status: 200, body: 'late' }), 500))
    });

    assert.strictEqual(auditResult.status, 'crawl_stuck', 'Status must be crawl_stuck');
    assert(auditResult.tags.includes('crawl_stuck'), 'Must include crawl_stuck tag');
    assert.strictEqual(auditResult.anomalies[0].type, 'CRAWL_STUCK', 'Anomaly type must be CRAWL_STUCK');
    assert(auditResult.anomalies[0].message.includes('more than 3 minutes'), 'Message must explain timeout skip');
  });

  test('getSchoolsForScannerBatch strictly prioritizes previously unscanned schools (verified_at IS NULL) first', () => {
    const unverifiedBatch = db.getSchoolsForScannerBatch('ALL_INDEPENDENT', 20);
    assert(unverifiedBatch.length > 0, 'Batch should return schools');

    // Unscanned schools must precede any previously scanned schools
    let seenScanned = false;
    for (const s of unverifiedBatch) {
      if (s.verified_at) {
        seenScanned = true;
      } else {
        assert.strictEqual(seenScanned, false, `Unscanned school ${s.name} must appear before already scanned schools`);
      }
    }
  });

  console.log(`\n======================================================`);
  console.log(`Test Results: ${passed} passed, ${failed} failed`);
  console.log(`======================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
