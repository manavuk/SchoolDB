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
assert(html.includes('id="classic-shortlist-badge-count"'), 'Missing Shortlist badge counter');

// Subpanes
assert(html.includes('id="classic-subpane-find"'), 'Missing Find Schools subpane');
assert(html.includes('id="classic-subpane-shortlist"'), 'Missing My Shortlist subpane');
assert(html.includes('id="classic-subpane-timeline"'), 'Missing Admission Timeline subpane');

console.log('✓ All 3 side-tabs and subpanes verified in index.html');

// 2. Verify JS controller functions
const js = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
assert(js.includes('function switchClassicSubTab'), 'Missing switchClassicSubTab function in app.js');
assert(js.includes('classic-side-tab'), 'Missing classic-side-tab selector handling in app.js');
assert(js.includes('classic-shortlist-badge-count'), 'Missing classic-shortlist-badge-count handling in app.js');

console.log('✓ Classic side-tab controller logic verified in app.js');
console.log('====================================================');
console.log('🎉 ALL CLASSIC PORTAL TAB NAVIGATION TESTS PASSED!');
console.log('====================================================');
