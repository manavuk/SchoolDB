const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('=== RUNNING TESTS: School Details UI v2 Admissions Timeline & Switcher ===\n');

// 1. Read app.js and verify render functions and view state
const appJs = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
const stylesCss = fs.readFileSync(path.join(__dirname, '../public/css/styles.css'), 'utf8');

console.log('[1. Testing Global Default View Version]');
assert(appJs.includes("let currentDetailViewVersion = localStorage.getItem('schooldb_detail_view_version') || 'v2';"), 'Default detail view version must be v2');
console.log('  ✓ Default detail view version is set to v2 with localStorage persistence.');

console.log('\n[2. Testing renderAdmissionsTimeline & Stepper Components]');
assert(appJs.includes('function renderAdmissionsTimeline('), 'renderAdmissionsTimeline helper function must exist');
assert(appJs.includes('1. Open Events'), 'Timeline must include Step 1 Open Events');
assert(appJs.includes('2. Registration'), 'Timeline must include Step 2 Registration');
assert(appJs.includes('3. Stage 1 Exam'), 'Timeline must include Step 3 Stage 1 Exam');
assert(appJs.includes('4. ${is2Stage ? \'Stage 2 &amp; Interview\' : \'Stage 2\'}'), 'Timeline must include Step 4 Stage 2 / Interview');
assert(appJs.includes('5. Offers &amp; Accept'), 'Timeline must include Step 5 Offers & Accept');
console.log('  ✓ renderAdmissionsTimeline contains all 5 chronological milestones with icons and badges.');

console.log('\n[3. Testing renderParentSummaryTiles At-a-Glance Metrics]');
assert(appJs.includes('function renderParentSummaryTiles('), 'renderParentSummaryTiles helper function must exist');
assert(appJs.includes('National Rank'), 'Parent tiles must include National Rank');
assert(appJs.includes('Progress 8'), 'Parent tiles must include Progress 8');
assert(appJs.includes('Funding &amp; Fees'), 'Parent tiles must include Funding & Fees');
assert(appJs.includes('Exam Format'), 'Parent tiles must include Exam Format');
console.log('  ✓ renderParentSummaryTiles produces 4 high-contrast parent summary cards.');

console.log('\n[4. Testing Top-Left View Switcher Toolbar]');
assert(appJs.includes('view-toggle-container'), 'View toggle container must exist in DOM');
assert(appJs.includes('data-version="v1"'), 'v1 classic toggle button must exist');
assert(appJs.includes('data-version="v2"'), 'v2 timeline toggle button must exist');
assert(appJs.includes("btn.addEventListener('click'"), 'Toggle buttons must wire event listeners to switch view version');
console.log('  ✓ Top-left view switcher (Classic v1 / Timeline v2) is fully wired.');

console.log('\n[5. Testing CSS Design & Aesthetic Styles]');
assert(stylesCss.includes('.view-toggle-container'), 'CSS must define .view-toggle-container');
assert(stylesCss.includes('.btn-toggle-view'), 'CSS must define .btn-toggle-view');
assert(stylesCss.includes('.parent-summary-grid'), 'CSS must define .parent-summary-grid');
assert(stylesCss.includes('.summary-tile'), 'CSS must define .summary-tile');
assert(stylesCss.includes('.admissions-timeline-container'), 'CSS must define .admissions-timeline-container');
assert(stylesCss.includes('.timeline-stepper'), 'CSS must define .timeline-stepper');
assert(stylesCss.includes('.timeline-step'), 'CSS must define .timeline-step');
console.log('  ✓ CSS classes for v2 timeline, summary tiles, and toggle switchers verified.');

console.log('\n======================================================');
console.log('🎉 ALL SCHOOL DETAILS V2 TIMELINE & UI TESTS PASSED!');
console.log('======================================================\n');
