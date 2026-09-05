const assert = require('assert');
const fs = require('fs');
const path = require('path');
const db = require('../db');

console.log('=== RUNNING TESTS: Data Enrichment Dropdown Batch Limits (200 & 500) ===\n');

// 1. Verify HTML markup in index.html
console.log('[1. Testing index.html Dropdown Options]');
const adminHtmlPath = path.join(__dirname, '../public/admin.html');
const indexHtml = fs.existsSync(adminHtmlPath) ? fs.readFileSync(adminHtmlPath, 'utf8') : fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

assert(indexHtml.includes('<option value="200">200 schools</option>'), 'index.html must include option value 200');
console.log('  ✓ Found <option value="200">200 schools</option>');

assert(indexHtml.includes('<option value="500">500 schools</option>'), 'index.html must include option value 500');
console.log('  ✓ Found <option value="500">500 schools</option>');

// 2. Test db query execution for limits 200 and 500
console.log('\n[2. Testing Database Batch Query with Limits 200 and 500]');
const batch200 = db.getSchoolsForScannerBatch('ALL', 200, 0);
assert(Array.isArray(batch200), 'Batch result must be an array');
assert(batch200.length > 0 && batch200.length <= 200, `Batch size for 200 must be <= 200, got: ${batch200.length}`);
console.log(`  ✓ Query with limit=200 retrieved ${batch200.length} schools`);

const batch500 = db.getSchoolsForScannerBatch('ALL', 500, 0);
assert(Array.isArray(batch500), 'Batch result must be an array');
assert(batch500.length > 0 && batch500.length <= 500, `Batch size for 500 must be <= 500, got: ${batch500.length}`);
console.log(`  ✓ Query with limit=500 retrieved ${batch500.length} schools`);

console.log('\n======================================================');
console.log('🎉 ALL DROPDOWN BATCH LIMIT TESTS PASSED!');
console.log('======================================================\n');
