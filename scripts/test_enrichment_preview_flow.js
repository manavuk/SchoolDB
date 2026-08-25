const assert = require('assert');
const db = require('../db');
const fs = require('fs');
const path = require('path');

console.log('--- Testing Automated Enrichment Preview & Accept/Reject Workflow ---');

// 1. Test generateEnrichmentPreview()
const preview = db.generateEnrichmentPreview();
console.log('Enrichment Preview Stats:', {
  totalSchoolsScanned: preview.totalSchoolsScanned,
  totalSchoolsWithChanges: preview.totalSchoolsWithChanges,
  stats: preview.stats
});

assert(preview.totalSchoolsScanned >= 6400, 'Must scan all secondary schools (>= 6400)');
assert(Array.isArray(preview.proposedChanges), 'proposedChanges must be an array');
console.log('✓ generateEnrichmentPreview operates cleanly without errors.');

// 2. Test Selective Commit Flow
const testSchoolId = 'sch-test-preview-' + Date.now();
try {
  db.insertSchool({
    id: testSchoolId,
    name: 'Test Comprehensive Academy',
    urn: '999111222',
    la: 'Camden',
    region: 'Greater London',
    schoolType: 'Comprehensive',
    entranceExamType: '',
    entranceExamDates: ''
  });

  // Generate preview specifically detecting this school
  const testPreview = db.generateEnrichmentPreview();
  const changeItem = testPreview.proposedChanges.find(c => c.schoolId === testSchoolId);
  assert(changeItem, 'Dry-run preview must detect change for un-enriched school');
  assert(Array.isArray(changeItem.sources), 'changeItem must have a sources array');
  assert(changeItem.sources.length >= 2, 'changeItem must have at least 2 source references');
  assert(changeItem.sources.some(s => s.url.includes('get-information-schools')), 'Must include DfE GIAS link');
  assert(changeItem.sources.some(s => s.url.includes('eadmissions') || s.url.includes('gov.uk')), 'Must include statutory policy link');
  console.log('Sample Proposed Change with Sources:', {
    name: changeItem.schoolName,
    changedFields: changeItem.changedFields,
    proposedExamType: changeItem.proposed.entranceExamType,
    sourcesCount: changeItem.sources.length,
    sampleSource: changeItem.sources[0]
  });

  // 3. Test db.commitEnrichmentChanges
  const commitResult = db.commitEnrichmentChanges([changeItem], 'Tester Admin');
  assert.strictEqual(commitResult.count, 1, 'Should commit exactly 1 school change');

  const committedSchool = db.getSchoolById(testSchoolId);
  assert(committedSchool.entranceExamType.includes('Non-selective'), 'Committed school must have updated entranceExamType');
  assert(committedSchool.entranceExamDates && JSON.stringify(committedSchool.entranceExamDates).includes('2026'), 'Committed school must have updated dates');
  console.log('✓ Selective commit applied cleanly and verified in database.');
} finally {
  db.deleteSchool(testSchoolId);
}

// 4. Test Frontend HTML, CSS, JS Elements
const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
assert(html.includes('id="admin-enrichment-preview-modal"'), 'index.html must have admin-enrichment-preview-modal');
assert(html.includes('id="btn-accept-all-enrichment"'), 'index.html must have btn-accept-all-enrichment');
assert(html.includes('id="btn-commit-selected-enrichment"'), 'index.html must have btn-commit-selected-enrichment');
assert(html.includes('id="admin-enrichment-preview-cards"'), 'index.html must have admin-enrichment-preview-cards container');
console.log('✓ All modal DOM elements verified in index.html.');

const js = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
assert(js.includes('openEnrichmentPreviewModal'), 'app.js must include openEnrichmentPreviewModal');
assert(js.includes('renderEnrichmentPreviewCards'), 'app.js must include renderEnrichmentPreviewCards');
assert(js.includes('commitSelectedEnrichment'), 'app.js must include commitSelectedEnrichment');
console.log('✓ All controller functions verified in app.js.');

console.log('\n====================================================');
console.log('🎉 ALL ENRICHMENT PREVIEW & ACCEPT/REJECT TESTS PASSED!');
console.log('====================================================');
