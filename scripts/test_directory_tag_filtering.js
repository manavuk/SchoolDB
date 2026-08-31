const assert = require('assert');
const fs = require('fs');
const path = require('path');
const db = require('../db');

console.log('=== RUNNING TESTS: Directory View Tag Search & Rich Attribute Filtering ===\n');

// Import server for route handler testing
const app = require('../server');

function getRouteHandler(method, pathStr) {
  const routes = app._router.stack
    .filter(r => r.route && r.route.path === pathStr && r.route.methods[method.toLowerCase()]);
  if (!routes.length) throw new Error(`Route not found: ${method} ${pathStr}`);
  return routes[0].route.stack[routes[0].route.stack.length - 1].handle;
}

function invokeGet(pathStr, query = {}) {
  return new Promise((resolve) => {
    const handler = getRouteHandler('GET', pathStr);
    const req = { query, params: {}, headers: {}, user: { name: 'Admin', role: 'admin' } };
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(data) { resolve({ status: this.statusCode, body: data }); },
      send(data) { resolve({ status: this.statusCode, body: data }); }
    };
    handler(req, res);
  });
}

async function runTests() {
  // 1. Test /api/stats includes regions
  console.log('[1. Testing /api/stats Endpoint]');
  const statsRes = await invokeGet('/api/stats');
  assert.strictEqual(statsRes.status, 200);
  assert(Array.isArray(statsRes.body.regions), 'Stats response must include regions array');
  assert(statsRes.body.regions.length > 0, 'Regions array must have items');
  console.log(`  ✓ /api/stats returned ${statsRes.body.regions.length} unique regions: ${statsRes.body.regions.slice(0, 5).join(', ')}...`);

  // 2. Test /api/schools Tag Filtering
  console.log('\n[2. Testing /api/schools Tag Filters]');

  // LLM enriched
  const llmRes = await invokeGet('/api/schools', { tag: 'llm_enriched' });
  assert.strictEqual(llmRes.status, 200);
  assert(llmRes.body.total > 0, 'Must return schools with LLM enrichment');
  console.log(`  ✓ tag=llm_enriched returned ${llmRes.body.total} schools`);

  // Dates verified
  const datesVerRes = await invokeGet('/api/schools', { tag: 'dates_verified' });
  assert.strictEqual(datesVerRes.status, 200);
  assert(datesVerRes.body.total > 0, 'Must return schools with verified dates');
  console.log(`  ✓ tag=dates_verified returned ${datesVerRes.body.total} schools`);

  // Dates recorded
  const datesRes = await invokeGet('/api/schools', { tag: 'dates_recorded' });
  assert.strictEqual(datesRes.status, 200);
  assert(datesRes.body.total > 0, 'Must return schools with dates recorded');
  console.log(`  ✓ tag=dates_recorded returned ${datesRes.body.total} schools`);

  // Has website
  const webRes = await invokeGet('/api/schools', { tag: 'has_website' });
  assert.strictEqual(webRes.status, 200);
  assert(webRes.body.total > 0, 'Must return schools with websites');
  console.log(`  ✓ tag=has_website returned ${webRes.body.total} schools`);

  // Has anomalies
  const anomalyRes = await invokeGet('/api/schools', { tag: 'has_anomalies' });
  assert.strictEqual(anomalyRes.status, 200);
  assert(anomalyRes.body.total > 0, 'Must return schools with anomalies/review flags');
  console.log(`  ✓ tag=has_anomalies returned ${anomalyRes.body.total} schools`);

  // 2-Stage Exam
  const stageRes = await invokeGet('/api/schools', { tag: 'two_stage_exam' });
  assert.strictEqual(stageRes.status, 200);
  console.log(`  ✓ tag=two_stage_exam returned ${stageRes.body.total} schools`);

  // Auto verified
  const autoVerRes = await invokeGet('/api/schools', { tag: 'auto_verified' });
  assert.strictEqual(autoVerRes.status, 200);
  console.log(`  ✓ tag=auto_verified returned ${autoVerRes.body.total} schools`);

  // Fees recorded
  const feesRes = await invokeGet('/api/schools', { tag: 'fees_recorded' });
  assert.strictEqual(feesRes.status, 200);
  console.log(`  ✓ tag=fees_recorded returned ${feesRes.body.total} schools`);

  // Unscanned
  const unscannedRes = await invokeGet('/api/schools', { tag: 'unscanned' });
  assert.strictEqual(unscannedRes.status, 200);
  console.log(`  ✓ tag=unscanned returned ${unscannedRes.body.total} schools`);

  // 3. Test Region Filter
  console.log('\n[3. Testing Region Filter]');
  const londonRes = await invokeGet('/api/schools', { region: 'Greater London' });
  assert.strictEqual(londonRes.status, 200);
  assert(londonRes.body.total > 0, 'Must return schools in Greater London');
  assert(londonRes.body.schools.every(s => s.region === 'Greater London'), 'All returned schools must be in Greater London');
  console.log(`  ✓ region="Greater London" returned ${londonRes.body.total} schools`);

  // 4. Test 2nd Stage Exam Filter
  console.log('\n[4. Testing 2nd Stage Exam Filter]');
  const stageYesRes = await invokeGet('/api/schools', { secondStage: 'yes' });
  assert.strictEqual(stageYesRes.status, 200);
  console.log(`  ✓ secondStage=yes returned ${stageYesRes.body.total} schools`);

  // 5. Test Fee & Funding Filter
  console.log('\n[5. Testing Funding & Fee Status Filter]');
  const indepRes = await invokeGet('/api/schools', { fee: 'independent' });
  assert.strictEqual(indepRes.status, 200);
  assert(indepRes.body.schools.every(s => s.schoolType && s.schoolType.includes('Independent')), 'All must be Independent schools');
  console.log(`  ✓ fee=independent returned ${indepRes.body.total} schools`);

  const stateRes = await invokeGet('/api/schools', { fee: 'state' });
  assert.strictEqual(stateRes.status, 200);
  assert(stateRes.body.schools.every(s => s.schoolType === 'Comprehensive' || s.schoolType === 'Grammar' || s.schoolType === 'State'), 'All must be state/grammar schools');
  console.log(`  ✓ fee=state returned ${stateRes.body.total} schools`);

  // 6. Test Confidence Filter
  console.log('\n[6. Testing Data Confidence Filter]');
  const confRes = await invokeGet('/api/schools', { confidence: 'high' });
  assert.strictEqual(confRes.status, 200);
  assert(confRes.body.schools.every(s => (s.confidence_score || 0) >= 80), 'All schools must have confidence_score >= 80');
  console.log(`  ✓ confidence=high returned ${confRes.body.total} schools`);

  // 7. Test Expanded Multi-Field Keyword Search
  console.log('\n[7. Testing Expanded Keyword Search]');
  // Search by URN
  const firstSchool = datesRes.body.schools[0];
  if (firstSchool && firstSchool.urn) {
    const urnRes = await invokeGet('/api/schools', { search: firstSchool.urn });
    assert.strictEqual(urnRes.status, 200);
    assert(urnRes.body.schools.some(s => s.id === firstSchool.id), 'Search must find school by URN');
    console.log(`  ✓ Search by URN "${firstSchool.urn}" successfully matched school "${firstSchool.name}"`);
  }

  // Search by Exam Type keyword
  const isebRes = await invokeGet('/api/schools', { search: 'ISEB' });
  assert.strictEqual(isebRes.status, 200);
  assert(isebRes.body.total > 0, 'Search by "ISEB" must return matches');
  console.log(`  ✓ Search by "ISEB" returned ${isebRes.body.total} schools`);

  // 8. Test HTML & CSS DOM Elements
  console.log('\n[8. Verifying HTML & CSS DOM Integration]');
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  assert(html.includes('id="tag-select"'), 'index.html must have #tag-select');
  assert(html.includes('id="region-select"'), 'index.html must have #region-select');
  assert(html.includes('id="second-stage-select"'), 'index.html must have #second-stage-select');
  assert(html.includes('id="confidence-select"'), 'index.html must have #confidence-select');
  assert(html.includes('id="fee-select"'), 'index.html must have #fee-select');
  console.log('  ✓ Verified all filter elements (#tag-select, #region-select, #second-stage-select, #confidence-select, #fee-select) in index.html');

  const css = fs.readFileSync(path.join(__dirname, '../public/css/styles.css'), 'utf8');
  assert(css.includes('.badge-tag'), 'styles.css must have .badge-tag');
  assert(css.includes('.badge-tag-llm'), 'styles.css must have .badge-tag-llm');
  assert(css.includes('.badge-tag-verified'), 'styles.css must have .badge-tag-verified');
  assert(css.includes('.badge-tag-stage'), 'styles.css must have .badge-tag-stage');
  assert(css.includes('.badge-tag-dates'), 'styles.css must have .badge-tag-dates');
  console.log('  ✓ Verified tag badge CSS styles in styles.css');

  const js = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
  assert(js.includes('tag-select'), 'app.js must reference tag-select');
  assert(js.includes('data-tag-filter'), 'app.js must support data-tag-filter click events');
  console.log('  ✓ Verified click-to-filter badge integration in app.js');

  console.log('\n======================================================');
  console.log('🎉 ALL DIRECTORY TAG & ATTRIBUTE FILTER TESTS PASSED!');
  console.log('======================================================\n');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
