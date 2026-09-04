const assert = require('assert');
const fs = require('fs');
const path = require('path');
const express = require('express');

console.log('=== RUNNING TESTS: Admin Quality & Scans Tabs (Pillars 2, 3, 4, 5) ===\n');

// 1. Verify index.html side tabs and subpanes
console.log('[1. Testing Admin Navigation Tabs & Subpanes in index.html]');
const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

const expectedTabs = [
  'data-target-tab="gias-backfill"',
  'data-target-tab="admissions-guardrails"',
  'data-target-tab="website-health"',
  'data-target-tab="deduplication"'
];

for (const tab of expectedTabs) {
  assert(indexHtml.includes(tab), `index.html must include side tab: ${tab}`);
  console.log(`  ✓ Found tab button: ${tab}`);
}

const expectedSubpanes = [
  'id="admin-subpane-gias-backfill"',
  'id="admin-subpane-admissions-guardrails"',
  'id="admin-subpane-website-health"',
  'id="admin-subpane-deduplication"'
];

for (const pane of expectedSubpanes) {
  assert(indexHtml.includes(pane), `index.html must include subpane: ${pane}`);
  console.log(`  ✓ Found subpane container: ${pane}`);
}

// 2. Verify app.js client controllers
console.log('\n[2. Testing Client Controllers in app.js]');
const appJs = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');

const expectedControllers = [
  'initGiasBackfillTab',
  'runGiasBackfillTrigger',
  'initAdmissionsGuardrailsTab',
  'runAdmissionsGuardrailsTrigger',
  'initWebsiteHealthTab',
  'runWebsiteHealthTrigger',
  'initDeduplicationTab',
  'runDeduplicationCandidatesScan',
  'executeAtomicMerge'
];

for (const fn of expectedControllers) {
  assert(appJs.includes(fn), `app.js must define controller: ${fn}`);
  console.log(`  ✓ Found controller function: ${fn}`);
}

// 3. Verify server.js endpoints exist
console.log('\n[3. Testing Quality API Endpoints in server.js]');
const serverJs = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

const expectedEndpoints = [
  '/api/admin/quality/gias/status',
  '/api/admin/quality/gias/run',
  '/api/admin/quality/guardrails/status',
  '/api/admin/quality/guardrails/run',
  '/api/admin/quality/website-health/status',
  '/api/admin/quality/website-health/run',
  '/api/admin/quality/deduplication/candidates',
  '/api/admin/quality/deduplication/merge'
];

for (const ep of expectedEndpoints) {
  assert(serverJs.includes(ep), `server.js must define endpoint: ${ep}`);
  console.log(`  ✓ Found API endpoint: ${ep}`);
}

console.log('\n======================================================');
console.log('🎉 ALL ADMIN QUALITY TABS & ENDPOINT TESTS PASSED!');
console.log('======================================================\n');
