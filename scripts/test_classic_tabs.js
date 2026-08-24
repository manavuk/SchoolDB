const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('--- Testing Classic Portal Left Tab Navigation ---');

// 1. Verify HTML Structure
const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

// Side tabs
assert(html.includes('id="classic-side-tab-find"'), 'Missing Find Schools side tab button');
assert(html.includes('id="classic-side-tab-shortlist"'), 'Missing My Shortlist side tab button');
assert(html.includes('id="classic-side-tab-timeline"'), 'Missing Admission Timeline side tab button');
assert(html.includes('id="classic-side-tab-dualtrack"'), 'Missing Dual Tracking side tab button');
assert(html.includes('id="classic-shortlist-badge-count"'), 'Missing Shortlist badge counter');

// Subpanes
assert(html.includes('id="classic-subpane-find"'), 'Missing Find Schools subpane');
assert(html.includes('id="classic-subpane-shortlist"'), 'Missing My Shortlist subpane');
assert(html.includes('id="classic-subpane-timeline"'), 'Missing Admission Timeline subpane');
assert(html.includes('id="classic-subpane-dualtrack"'), 'Missing Dual Tracking subpane');

// 2. Verify JS controller functions
const js = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
assert(js.includes('function switchClassicSubTab'), 'Missing switchClassicSubTab function in app.js');
assert(js.includes('classic-side-tab'), 'Missing classic-side-tab selector handling in app.js');
assert(js.includes('classic-shortlist-badge-count'), 'Missing classic-shortlist-badge-count handling in app.js');

// 3. Verify Omni-Discovery Bar Components
assert(html.includes('id="rec-gender-btn"'), 'Missing Gender multi-select button');
assert(html.includes('id="rec-gender-dropdown"'), 'Missing Gender multi-select dropdown');
assert(html.includes('id="rec-school-type-btn"'), 'Missing Target School Types multi-select button');
assert(html.includes('id="rec-school-type-dropdown"'), 'Missing Target School Types multi-select dropdown');
assert(html.includes('id="rec-priorities-btn"'), 'Missing Priority Weights dropdown button');
assert(html.includes('id="rec-priorities-dropdown"'), 'Missing Priority Weights dropdown');
assert(html.includes('id="rec-qual-prox-slider"'), 'Missing Commute Proximity slider');
assert(html.includes('id="rec-qual-acad-slider"'), 'Missing GCSE Attainment 8 slider');
assert(html.includes('id="rec-qual-prog-slider"'), 'Missing Progress 8 Growth slider');

// 4. Verify Auto-Recommend, Sliders & Collapsible Sidebar JS Logic
assert(html.includes('id="btn-toggle-classic-sidebar"'), 'Missing Collapse Sidebar toggle button');
assert(js.includes('setupClassicSidebarToggle'), 'Missing setupClassicSidebarToggle function in app.js');
assert(js.includes('triggerAutoRecommend'), 'Missing triggerAutoRecommend function in app.js');
assert(js.includes('updatePrioritySlidersUI'), 'Missing updatePrioritySlidersUI function in app.js');
assert(js.includes('updateGenderDropdownLabel'), 'Missing updateGenderDropdownLabel function in app.js');
assert(js.includes('updateSchoolTypeDropdownLabel'), 'Missing updateSchoolTypeDropdownLabel function in app.js');

console.log('✓ Omni-Discovery bar, Priority Sliders, Auto-Recommend, and Collapsible Sidebar logic verified');
console.log('====================================================');
console.log('🎉 ALL CLASSIC PORTAL TAB NAVIGATION TESTS PASSED!');
console.log('====================================================');
