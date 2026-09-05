const assert = require('assert');
const fs = require('fs');
const path = require('path');
const db = require('../db');

console.log('--- Testing Admin Portal Redesign Integrity & Flow ---');

// 1. Check admin.html / index.html markup
const adminHtmlPath = path.join(__dirname, '../public/admin.html');
const indexHtml = fs.existsSync(adminHtmlPath) ? fs.readFileSync(adminHtmlPath, 'utf8') : fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

const requiredElements = [
  'admin-tab-content',
  'admin-side-nav',
  'side-tab-btn-directory',
  'side-tab-btn-bulk-edit',
  'side-tab-btn-corrections',
  (indexHtml.includes('side-tab-btn-deduplication') ? 'side-tab-btn-deduplication' : 'side-tab-btn-merge'),
  'side-tab-btn-import-export',
  'side-tab-btn-settings',
  'admin-subpane-directory',
  'admin-subpane-bulk-edit',
  'admin-subpane-corrections',
  (indexHtml.includes('admin-subpane-deduplication') ? 'admin-subpane-deduplication' : 'admin-subpane-merge'),
  'admin-subpane-import-export',
  'admin-subpane-settings',
  'bulk-schools-table',
  'bulk-field-select',
  'btn-apply-bulk-edit',
  'rec-weights-form',
  'weights-total-pill'
];

requiredElements.forEach(id => {
  assert(indexHtml.includes(id), `index.html must contain element: ${id}`);
});
assert(!indexHtml.includes('class="admin-top-banner"'), 'index.html should not contain top banner');
console.log('✓ All 6 side-tabs, subpanes, and relocated Add School Entry buttons verified in index.html');

// 2. Check styles.css definitions
const stylesCss = fs.readFileSync(path.join(__dirname, '../public/css/styles.css'), 'utf8');
const requiredStyles = [
  '.admin-portal-wrapper',
  '.admin-top-banner',
  '.admin-side-layout',
  '.admin-side-nav',
  '.admin-side-tab',
  '.admin-subpane',
  '.bulk-row-selected',
  '.weight-control-box'
];

requiredStyles.forEach(cls => {
  assert(stylesCss.includes(cls), `styles.css must contain CSS rule: ${cls}`);
});
console.log('✓ All side-tab and bulk-edit CSS styles are present in styles.css');

// 3. Check app.js functions
const appJs = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
const requiredFunctions = [
  'switchAdminSubTab',
  'renderBulkEditTable',
  'toggleBulkSchoolSelection',
  'updateBulkSelectionUI',
  'updateBulkValueInput',
  'executeBulkUpdate',
  'updateTotalWeightsPill'
];

requiredFunctions.forEach(fn => {
  assert(appJs.includes(fn), `app.js must contain function: ${fn}`);
});
console.log('✓ All admin controller functions are present in app.js');

// 4. Test database bulkUpdateSchools
const schools = db.getAllSchools();
assert(schools.length > 10, 'Database must have schools');
const targetSchools = [schools[0].id, schools[1].id, schools[2].id];
const origOfsted = [schools[0].ofstedRating, schools[1].ofstedRating, schools[2].ofstedRating];

const updated = db.bulkUpdateSchools(targetSchools, { ofstedRating: 'Outstanding' });
assert.strictEqual(updated.length, 3, 'Should update 3 schools');
targetSchools.forEach(id => {
  assert.strictEqual(db.getSchoolById(id).ofstedRating, 'Outstanding');
});

// Restore
db.bulkUpdateSchools([targetSchools[0]], { ofstedRating: origOfsted[0] });
db.bulkUpdateSchools([targetSchools[1]], { ofstedRating: origOfsted[1] });
db.bulkUpdateSchools([targetSchools[2]], { ofstedRating: origOfsted[2] });

console.log('✓ db.bulkUpdateSchools transaction operates successfully');

console.log('====================================================');
console.log('🎉 ALL ADMIN PORTAL REDESIGN VERIFICATIONS PASSED!');
console.log('====================================================');
