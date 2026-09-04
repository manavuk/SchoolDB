const assert = require('assert');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { checkUrlHealth, auditSchoolsWebsiteHealth } = require('./check_website_health');

console.log('=== RUNNING TESTS: Automated Website Health & Detailed Results ===\n');

(async () => {
  // 1. Testing checkUrlHealth directly
  console.log('[1. Testing checkUrlHealth Probe Mechanism]');
  const resValid = await checkUrlHealth('https://www.google.com', 4000);
  assert(resValid && typeof resValid.statusCode === 'number', 'Must return valid response');
  assert(resValid.responseTimeMs >= 0, 'Must record latency in ms');
  console.log(`  ✓ checkUrlHealth verified live probe (Status: ${resValid.statusLabel}, Latency: ${resValid.responseTimeMs}ms)`);

  const resInvalid = await checkUrlHealth('not-a-valid-url');
  assert.strictEqual(resInvalid.status, 'invalid_url', 'Invalid URL must be flagged');
  console.log('  ✓ checkUrlHealth gracefully handles invalid URLs');

  // 2. Testing auditSchoolsWebsiteHealth on sample schools
  console.log('\n[2. Testing auditSchoolsWebsiteHealth Execution & Itemized Results]');
  const sampleSchools = [
    { id: 'sch-wh-1', name: 'QE Boys Barnet', website: 'https://www.qebarnet.co.uk' },
    { id: 'sch-wh-2', name: 'Ashbourne College', website: 'http://www.ashbournecollege.co.uk' },
    { id: 'sch-wh-3', name: 'Broken Dummy School', website: 'https://www.nonexistent-domain-123456789.org.uk' }
  ];

  const auditSummary = await auditSchoolsWebsiteHealth(sampleSchools, 3);
  assert(auditSummary, 'Must return audit summary');
  assert.strictEqual(auditSummary.checkedCount, 3, 'Must have checked 3 schools');
  assert(Array.isArray(auditSummary.results), 'Must return results array');
  assert.strictEqual(auditSummary.results.length, 3, 'Results array must contain 3 items');

  const firstItem = auditSummary.results[0];
  assert(firstItem.schoolName, 'Result must contain schoolName');
  assert(firstItem.originalUrl, 'Result must contain originalUrl');
  assert(firstItem.actionTaken, 'Result must contain actionTaken');
  assert(firstItem.statusLabel, 'Result must contain statusLabel');
  assert(typeof firstItem.responseTimeMs === 'number', 'Result must contain responseTimeMs');
  console.log('  ✓ auditSchoolsWebsiteHealth generated complete itemized audit payload with latency and action taken.');

  // 3. Testing UI elements and controller bindings
  console.log('\n[3. Testing Frontend Markup & Controller Functions]');
  const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  assert(indexHtml.includes('id="website-health-table-wrapper"'), 'index.html must include website-health-table-wrapper');
  assert(indexHtml.includes('id="webhealth-filter-input"'), 'index.html must include search filter');
  assert(indexHtml.includes('id="webhealth-status-filter"'), 'index.html must include status filter');
  assert(indexHtml.includes('id="website-health-table-body"'), 'index.html must include table body');

  const appJs = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
  assert(appJs.includes('renderWebsiteHealthResultsTable'), 'app.js must define renderWebsiteHealthResultsTable');
  assert(appJs.includes('websiteHealthLastResults'), 'app.js must maintain websiteHealthLastResults state');
  console.log('  ✓ All frontend elements, search filters, and table render controllers verified.');

  console.log('\n========================================================================');
  console.log('🎉 ALL WEBSITE HEALTH AUDIT & DETAILED RESULTS TESTS PASSED!');
  console.log('========================================================================\n');
})();
