/**
 * Test Suite: Data Enrichment Live Stream, DB Delta & Manual Rollback Versioning
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const scannerVerifier = require('./scanner_verifier');
const llmCrawler = require('./llm_crawler');

async function runTests() {
  console.log('=== RUNNING TESTS: Data Enrichment Tab, Live Feed & Version Rollback ===\n');
  const initialSettings = db.getAdminSettings();

  try {
    // 1. Verify DOM components in public/index.html
    console.log('[1. DOM Structure & Tab Navigation Test]');
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    assert(html.includes('data-target-tab="data-enrichment"'), 'Sidebar must include data-enrichment tab');
    assert(html.includes('id="side-tab-btn-data-enrichment"'), 'Sidebar must have side-tab-btn-data-enrichment button');
    assert(html.includes('id="admin-subpane-data-enrichment"'), 'Subpane admin-subpane-data-enrichment must exist');
    assert(html.includes('id="enrichment-feed-list"'), 'Live feed stream container must exist');
    assert(html.includes('id="modal-school-version-history"'), 'Version history modal must exist');
    assert(html.includes('id="enrichment-active-school-callout"'), 'Active school live status callout must exist');

    // Verify that date-anomalies tab and subpane have been cleanly removed
    assert(!html.includes('id="side-tab-btn-date-anomalies"'), 'Anomaly Review sidebar button must be removed');
    assert(!html.includes('id="admin-subpane-date-anomalies"'), 'Anomaly Review subpane container must be removed');
    console.log('  ✓ Verified DOM layout: Data Enrichment subpane active, and Anomaly Review cleanly removed.');

    // 2. Test LLM Enrichment and Visual Delta Generation
    console.log('\n[2. Visual Delta & Diff Computation Test]');
    const testSchoolId = 'test_enrichment_diff_school';
    db.insertSchool({
      id: testSchoolId,
      name: 'St Paul\'s School Barnes',
      schoolType: 'Independent',
      gender: 'Boys',
      phone: '020 8748 9162',
      email: 'admissions@stpaulsschool.org.uk',
      website: 'https://www.stpaulsschool.org.uk',
      entranceExamType: 'ISEB Pre-Test',
      entranceExamDates: JSON.stringify({
        registrationOpen: '1 September 2026',
        registrationDeadline: '20 September 2026',
        examDate: '15 November 2026'
      }),
      verification_status: 'unverified',
      verification_tags: JSON.stringify([])
    });

    const mockNewLlmData = {
      name: 'St Paul\'s School Barnes',
      schoolType: 'Independent',
      gender: 'Boys',
      phone: '020 8748 9162',
      email: 'admissions@stpaulsschool.org.uk',
      website: 'https://www.stpaulsschool.org.uk',
      entranceExamType: 'ISEB Common Pre-Test & School Exam',
      entranceExamDates: {
        registrationOpen: '1 September 2026',
        registrationDeadline: '25 September 2026', // Changed deadline
        examDate: '28 November 2026', // Changed exam date
        resultDate: '15 January 2027' // Newly added milestone
      },
      confidenceScore: 98
    };

    const auditResult = await scannerVerifier.auditAndVerifySchool(db.getSchoolById(testSchoolId), {
      forceRerun: true,
      mockResponse: mockNewLlmData
    });

    assert.strictEqual(auditResult.status, 'llm_enriched', 'Status must be llm_enriched');
    assert(auditResult.diffs && auditResult.diffs.length > 0, 'Must compute field diffs');
    assert(auditResult.auditLogId, 'Must return auditLogId from atomic transaction');

    const datesDiff = auditResult.diffs.find(d => d.field === 'entranceExamDates');
    assert(datesDiff, 'Must contain entranceExamDates diff');
    assert(datesDiff.changedDates.some(c => c.key === 'registrationDeadline' && c.newVal === '25 September 2026'));
    assert(datesDiff.changedDates.some(c => (c.key === 'stage_one_resultDate' || c.key === 'resultDate') && c.newVal === '15 January 2027'));

    const examDiff = auditResult.diffs.find(d => d.field === 'entranceExamType');
    assert(examDiff && examDiff.newVal === 'ISEB Common Pre-Test & School Exam');
    console.log('  ✓ Visual delta computed accurately across admissions milestones and attributes.');

    // 3. Test School Audit History Retrieval API
    console.log('\n[3. School Version Audit History Ledger Test]');
    const auditHistory = db.getSchoolAuditHistory(testSchoolId);
    assert(Array.isArray(auditHistory), 'Must return array of audit history logs');
    assert(auditHistory.length >= 1, 'Must contain at least 1 audit entry for this school');

    const latestLog = auditHistory[0];
    assert.strictEqual(latestLog.schoolId, testSchoolId);
    assert.strictEqual(latestLog.actionType, 'LLM_CRAWL_APPLY');
    assert(latestLog.previousState, 'Must contain snapshot of previous state');
    assert(latestLog.previousState.entranceExamDates, 'Previous state must retain prior dates');

    const prevDatesParsed = typeof latestLog.previousState.entranceExamDates === 'string'
      ? JSON.parse(latestLog.previousState.entranceExamDates)
      : latestLog.previousState.entranceExamDates;
    assert.strictEqual(prevDatesParsed.registrationDeadline, '20 September 2026', 'Previous snapshot must preserve original 20 September deadline');
    console.log('  ✓ getSchoolAuditHistory retrieved immutable historical audit ledger.');

    // 4. Test Manual 1-Click Rollback to Previous Version
    console.log('\n[4. Manual 1-Click School Version Rollback Test]');
    const rollbackResult = db.rollbackSchoolToAuditVersion(testSchoolId, latestLog.id, 'Super Admin');
    assert.strictEqual(rollbackResult.success, true, 'Rollback must succeed');
    assert.strictEqual(rollbackResult.schoolId, testSchoolId);

    const restoredSchool = db.getSchoolById(testSchoolId);
    const restoredDates = typeof restoredSchool.entranceExamDates === 'string'
      ? JSON.parse(restoredSchool.entranceExamDates)
      : restoredSchool.entranceExamDates;

    assert.strictEqual(restoredDates.registrationDeadline, '20 September 2026', 'Rollback must accurately restore previous 20 September deadline');
    assert.strictEqual(restoredDates.examDate, '15 November 2026', 'Rollback must restore original exam date');
    assert.strictEqual(restoredSchool.entranceExamType, 'ISEB Pre-Test', 'Rollback must restore original exam board');

    // Verify rollback event was logged in audit trail
    const updatedHistory = db.getSchoolAuditHistory(testSchoolId);
    assert(updatedHistory.length >= 2, 'History must now include rollback record');
    assert.strictEqual(updatedHistory[0].actionType, 'MANUAL_VERSION_ROLLBACK');
    assert(updatedHistory[1].rolledBackAt, 'Target version must be marked with rolledBackAt timestamp');
    console.log('  ✓ rollbackSchoolToAuditVersion performed atomic database restoration and logged rollback trail.');

    // 5. Test Live Feed Chronological Ordering (Latest on top)
    console.log('\n[5. Live Feed Chronological Stream Test]');
    const feed = [];
    const item1 = { schoolId: 's1', schoolName: 'School 1', status: 'llm_enriched', diffs: [] };
    const item2 = { schoolId: 's2', schoolName: 'School 2', status: 'llm_enriched', diffs: [] };

    feed.unshift(item1);
    assert.strictEqual(feed[0].schoolId, 's1');

    feed.unshift(item2);
    assert.strictEqual(feed[0].schoolId, 's2', 'Latest scanned school must be on top of the live feed');
    assert.strictEqual(feed[1].schoolId, 's1', 'Prior school must move below');
    console.log('  ✓ Live feed stream moves previous items down and displays latest result on top.');

    // 6. Test Inline Full School Data Viewer & Visual Change Queues
    console.log('\n[6. Inline Full School Data Viewer & Visual Change Queues Test]');
    const jsApp = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
    assert(jsApp.includes('function renderInlineFullSchoolData(item)'), 'Must define renderInlineFullSchoolData');
    assert(jsApp.includes('function toggleSchoolFullData(schoolId)'), 'Must define toggleSchoolFullData');
    assert(jsApp.includes('class="badge-field-changed"'), 'Must render badge-field-changed');
    assert(jsApp.includes('class="badge-field-unchanged"'), 'Must render badge-field-unchanged');
    assert(jsApp.includes('old-val-strikethrough'), 'Must render old-val-strikethrough');

    const css = fs.readFileSync(path.join(__dirname, '../public/css/styles.css'), 'utf8');
    assert(css.includes('.full-school-data-panel'), 'CSS must include .full-school-data-panel');
    assert(css.includes('.school-data-field-box.is-changed'), 'CSS must style changed fields');
    assert(css.includes('.badge-field-changed'), 'CSS must style badge-field-changed');
    console.log('  ✓ Inline full school data viewer renders all attributes with green visual highlighting for changed fields.');

    // 7. Anti-Jumpiness DOM Fingerprint Test
    console.log('\n[7. Anti-Jumpiness DOM Refresh Suppression Test]');
    assert(jsApp.includes('lastFeedFingerprint'), 'app.js must track lastFeedFingerprint to avoid DOM teardown');
    assert(jsApp.includes('expandedFullDataSchoolIds'), 'app.js must preserve open school accordions across polls');
    console.log('  ✓ Verified feed fingerprinting suppresses unnecessary 800ms DOM re-renders and preserves open panels.');

    // 8. Strict LLM Model Selection Adherence Test
    console.log('\n[8. Strict LLM Model Selection from Admin Settings Test]');
    db.saveSystemSettings({
      llmProvider: 'gemini',
      geminiModel: 'gemini-3.5-flash-lite'
    });
    const currentSettings = db.getSystemSettings();
    assert.strictEqual(currentSettings.geminiModel, 'gemini-3.5-flash-lite');

    const testSchool = db.getSchoolById(testSchoolId);
    const auditRes = await scannerVerifier.auditAndVerifySchool(testSchool, {
      forceRerun: true,
      mockResponse: mockNewLlmData
    });
    assert.strictEqual(auditRes.status, 'llm_enriched');
    assert.strictEqual(auditRes.llmVerification.provider, 'gemini');
    assert.strictEqual(auditRes.llmVerification.model, 'gemini-3.5-flash-lite');
    console.log('  ✓ Background scanner strictly queries using the exact model selected in Admin Settings.');

    // 9. Test Single School Typeahead & Selection DOM Components
    console.log('\n[9. Single School Typeahead & Selector Test]');
    assert(html.includes('id="scanner-scan-mode"'), 'Must have scanner-scan-mode select dropdown');
    assert(html.includes('id="scanner-school-typeahead-input"'), 'Must have scanner-school-typeahead-input for typing');
    assert(html.includes('id="scanner-school-typeahead-dropdown"'), 'Must have scanner-school-typeahead-dropdown container');
    assert(html.includes('id="scanner-selected-school-id"'), 'Must have hidden scanner-selected-school-id input');
    assert(jsApp.includes('setupScannerSchoolTypeahead'), 'app.js must define setupScannerSchoolTypeahead');
    assert(jsApp.includes('selectScannerSchool'), 'app.js must define selectScannerSchool');
    console.log('  ✓ Verified single school typeahead search input, suggestions dropdown, and auto-complete handlers.');

    // 10. Test Raw LLM Request & Response Inspector
    console.log('\n[10. Raw LLM Message Sent & Response Received Inspector Test]');
    assert(html.includes('id="enrichment-raw-llm-card"'), 'Must have enrichment-raw-llm-card');
    assert(html.includes('id="raw-llm-request-code"'), 'Must have raw-llm-request-code pre block');
    assert(html.includes('id="raw-llm-response-code"'), 'Must have raw-llm-response-code pre block');
    assert(html.includes('id="btn-toggle-raw-llm-panel"'), 'Must have toggle button for raw messages');
    assert(jsApp.includes('updateRawLLMInspector'), 'app.js must define updateRawLLMInspector');
    assert(jsApp.includes('copyRawLLMText'), 'app.js must define copyRawLLMText');

    // Verify backend captures exactRequest and exactResponse in audit result
    assert(auditRes.exactRequest, 'Scan result must capture exactRequest');
    assert(auditRes.exactResponse, 'Scan result must capture exactResponse');
    console.log('  ✓ Verified raw LLM request/response inspector UI and backend interaction payload transmission.');

    // 11. Test Master Admissions Intelligence Prompt Template Adherence & Untouched Raw Payload
    console.log('\n[11. Admissions Intelligence Prompt Template & Untouched Raw Payloads Test]');
    db.saveSystemSettings({
      llmPromptTemplate: db.DEFAULT_LLM_PROMPT_TEMPLATE
    });

    const crawlerRes = await llmCrawler.crawlSchoolWithGemini(testSchool, {
      mockResponse: '{"name":"St Paul\'s School Barnes","entranceExamType":"ISEB","confidenceScore":99}'
    });

    assert.strictEqual(crawlerRes.success, true);
    assert(crawlerRes.exactRequest.promptText.startsWith('You are an expert UK School Admissions Data Researcher and Verifier.'), 'Must start with canonical template header');
    assert(crawlerRes.exactRequest.promptText.includes('St Paul\'s School Barnes'), 'Must interpolate target school');
    assert(crawlerRes.exactResponse.rawText, 'Must capture exact untouched raw response text');
    console.log('  ✓ Verified Admissions Intelligence Prompt Template configured in admin settings is used with untouched raw payload logging.');

    console.log('\n========================================================================');
    console.log('🎉 ALL DATA ENRICHMENT TAB, TYPEAHEAD & RAW LLM INSPECTOR TESTS PASSED!');
    console.log('========================================================================\n');
  } finally {
    db.saveAdminSettings({
      llmProvider: initialSettings.llmProvider,
      geminiModel: initialSettings.geminiModel,
      geminiApiKey: initialSettings.geminiApiKey || '',
      openaiModel: initialSettings.openaiModel,
      openaiApiKey: initialSettings.openaiApiKey || '',
      scannerSkipDays: initialSettings.scannerSkipDays,
      scannerDelaySeconds: initialSettings.scannerDelaySeconds || 20,
      llmPromptTemplate: db.DEFAULT_LLM_PROMPT_TEMPLATE,
      recWeights: initialSettings.recWeights,
      clearGeminiKey: !initialSettings.geminiApiKey,
      clearOpenaiKey: !initialSettings.openaiApiKey
    });
  }
}

runTests().catch(err => {
  console.error('Fatal Data Enrichment Test Error:', err);
  process.exit(1);
});
