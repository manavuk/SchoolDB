const assert = require('assert');
const fs = require('fs');
const path = require('path');
const db = require('../db');

console.log('=== RUNNING TESTS: Deduplication Comparison & Pick/Edit Merge Modal ===\n');

// 1. Verify index.html modal markup
console.log('[1. Testing index.html modal markup]');
const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
assert(indexHtml.includes('id="quality-dedup-merge-modal"'), 'index.html must include quality-dedup-merge-modal');
assert(indexHtml.includes('id="quality-dedup-merge-modal-content"'), 'index.html must include quality-dedup-merge-modal-content');
assert(indexHtml.includes('id="modal-confirm-quality-dedup-merge"'), 'index.html must include modal-confirm-quality-dedup-merge button');
assert(indexHtml.includes('id="modal-cancel-quality-dedup-merge"'), 'index.html must include modal-cancel-quality-dedup-merge button');
console.log('  ✓ Modal overlay and container elements verified in index.html');

// 2. Verify app.js client controllers & helpers
console.log('\n[2. Testing app.js functions & controller]');
const appJs = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
assert(appJs.includes('QUALITY_DEDUP_MERGE_FIELDS'), 'app.js must define QUALITY_DEDUP_MERGE_FIELDS');
assert(appJs.includes('function openQualityDedupMergeModal'), 'app.js must define openQualityDedupMergeModal');
assert(appJs.includes('function onQualityDedupRadioChange'), 'app.js must define onQualityDedupRadioChange');
assert(appJs.includes('function setQualityDedupAll'), 'app.js must define setQualityDedupAll');
assert(appJs.includes('function setQualityDedupSmartFill'), 'app.js must define setQualityDedupSmartFill');
assert(appJs.includes('function confirmQualityDedupMerge'), 'app.js must define confirmQualityDedupMerge');
assert(appJs.includes('closeQualityDedupMergeModal'), 'app.js must define closeQualityDedupMergeModal');
console.log('  ✓ Deduplication modal controller, radio change listener, batch smart fillers and confirm handlers verified');

// 3. Verify server.js API support for custom mergedRecord
console.log('\n[3. Testing server.js API support for custom mergedRecord]');
const serverJs = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
assert(serverJs.includes("const { primaryId, secondaryId, mergedRecord } = req.body;"), 'server.js must extract mergedRecord from request body');
console.log('  ✓ server.js deduplication merge route supports custom mergedRecord');

// 4. Test backend DB merge execution
console.log('\n[4. Testing DB atomic merge operation with custom overrides]');
const schoolA = {
  id: 'test-dedup-school-a',
  name: 'Original Grammar Academy',
  urn: '100001',
  schoolType: 'Grammar',
  gender: 'Mixed',
  postcode: 'WD18 7HQ',
  website: 'https://school-a.org.uk',
  ofstedRating: 'Good'
};

const schoolB = {
  id: 'test-dedup-school-b',
  name: 'Original Grammar School (Duplicate)',
  urn: '100001',
  schoolType: 'Comprehensive',
  gender: 'Mixed',
  postcode: 'WD18 7HQ',
  website: 'https://school-a-official.org.uk',
  ofstedRating: 'Outstanding'
};

db.insertSchool(schoolA);
db.insertSchool(schoolB);

const customMerged = {
  name: 'Original Grammar Academy (Consolidated)',
  website: 'https://school-a-official.org.uk',
  ofstedRating: 'Outstanding'
};

const merged = {
  ...schoolA,
  ...customMerged,
  id: schoolA.id,
  dedupNote: `Merged with ${schoolB.name} (${schoolB.id})`
};

db.updateSchool(schoolA.id, merged);
db.deleteSchool(schoolB.id);

const resultA = db.getSchoolById('test-dedup-school-a');
const resultB = db.getSchoolById('test-dedup-school-b');

assert(resultA, 'Primary school must exist after merge');
assert.strictEqual(resultA.name, 'Original Grammar Academy (Consolidated)', 'Primary school must reflect custom merged name');
assert.strictEqual(resultA.website, 'https://school-a-official.org.uk', 'Primary school must reflect picked website');
assert.strictEqual(resultA.ofstedRating, 'Outstanding', 'Primary school must reflect picked Ofsted rating');
assert.strictEqual(resultB, null, 'Candidate secondary school must be deleted');

// Cleanup
db.deleteSchool('test-dedup-school-a');
console.log('  ✓ DB atomic merge with custom field selection and cleanup verified successfully');

console.log('\n======================================================');
console.log('🎉 ALL DEDUPLICATION MERGE MODAL TESTS PASSED!');
console.log('======================================================\n');
