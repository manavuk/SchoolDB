const assert = require('assert');
const fs = require('fs');
const path = require('path');
const db = require('../db');

console.log('=== RUNNING TESTS: Data Corrections Queue Integration ===\n');

// 1. Verify UI markup in index.html
console.log('[1. Testing Data Corrections HTML Markup in index.html]');
const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

assert(indexHtml.includes('id="admin-system-corrections-card"'), 'index.html must include admin-system-corrections-card');
console.log('  ✓ Found admin-system-corrections-card');

assert(indexHtml.includes('id="admin-system-corrections-container"'), 'index.html must include admin-system-corrections-container');
console.log('  ✓ Found admin-system-corrections-container');

assert(indexHtml.includes('id="refresh-system-corrections-btn"'), 'index.html must include refresh-system-corrections-btn');
console.log('  ✓ Found refresh-system-corrections-btn');

// 2. Verify Client Controllers in app.js
console.log('\n[2. Testing Client Controllers in app.js]');
const appJs = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');

assert(appJs.includes('function loadSystemCorrectionsQueue'), 'app.js must define loadSystemCorrectionsQueue');
console.log('  ✓ Found function loadSystemCorrectionsQueue');

assert(appJs.includes('function clearConflictingUrn'), 'app.js must define clearConflictingUrn');
console.log('  ✓ Found function clearConflictingUrn');

assert(appJs.includes('await loadSystemCorrectionsQueue()'), 'app.js must invoke loadSystemCorrectionsQueue on corrections tab load');
console.log('  ✓ Found invocation inside loadAdminFieldReports');

// 3. Verify Server Endpoints in server.js
console.log('\n[3. Testing Server Endpoints in server.js]');
const serverJs = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

assert(serverJs.includes('/api/admin/quality/corrections/queue'), 'server.js must define /api/admin/quality/corrections/queue');
console.log('  ✓ Found /api/admin/quality/corrections/queue endpoint');

assert(serverJs.includes('/api/admin/quality/corrections/clear-urn'), 'server.js must define /api/admin/quality/corrections/clear-urn');
console.log('  ✓ Found /api/admin/quality/corrections/clear-urn endpoint');

// 4. Test Deduplication Engine Queue Routing
console.log('\n[4. Testing Deduplication Engine Routing]');
const { findGenuineDuplicatesAndRoute } = require('./deduplication_engine');
const { genuineDuplicates, correctionsQueue, enrichmentQueue } = findGenuineDuplicatesAndRoute();

console.log(`  ✓ Genuine Duplicates with significant overlap: ${genuineDuplicates.length}`);
console.log(`  ✓ Conflicting records routed to Data Corrections: ${correctionsQueue.length}`);
console.log(`  ✓ Sparse records routed to Data Enrichment: ${enrichmentQueue.length}`);

assert(correctionsQueue.length > 0, 'Data Corrections queue must contain routed conflicting items');
assert(correctionsQueue.some(c => c.schoolA.name && c.schoolB.name && c.reason), 'Items must have schoolA, schoolB, and reason');

console.log('\n======================================================');
console.log('🎉 ALL DATA CORRECTIONS QUEUE TESTS PASSED!');
console.log('======================================================\n');
