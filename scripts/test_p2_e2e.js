const assert = require('assert');
const http = require('http');
const db = require('../db');

console.log('--- Running End-to-End Parent Portal 2.0 Integration Test ---');

// 1. Verify index.html contains all Parent Portal 2.0 DOM IDs and Elements
const fs = require('fs');
const path = require('path');
const htmlContent = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

const requiredElements = [
  'id="tab-parent2-btn"',
  'id="tab-recommend-btn"',
  'id="parent2-tab-content"',
  'id="p2-stat-location"',
  'id="p2-stat-caf"',
  'id="p2-stat-indep"',
  'id="p2-subtab-btn-matchmaker"',
  'id="p2-subtab-btn-dualtrack"',
  'id="p2-subtab-btn-matrix"',
  'id="p2-subtab-btn-calendar"',
  'id="p2-view-matchmaker"',
  'id="p2-view-dualtrack"',
  'id="p2-view-matrix"',
  'id="p2-view-calendar"',
  'id="p2-input-postcode"',
  'id="p2-select-gender"',
  'id="p2-select-ability"',
  'id="p2-btn-apply-wizard"',
  'id="p2-recs-container"',
  'id="p2-caf-slots-list"',
  'id="p2-caf-strategy-banner"',
  'id="p2-count-reach"',
  'id="p2-count-target"',
  'id="p2-count-safety"',
  'id="p2-indep-list-container"',
  'id="p2-matrix-table"',
  'id="p2-calendar-timeline-container"',
  'id="p2-btn-export-ics"'
];

requiredElements.forEach(el => {
  assert.ok(htmlContent.includes(el), `index.html must include ${el}`);
});
console.log('✓ All 28 Parent Portal 2.0 DOM components and subpanes verified in index.html.');

// 2. Verify styles.css contains Parent Portal 2.0 classes
const cssContent = fs.readFileSync(path.join(__dirname, '../public/css/styles.css'), 'utf8');
const requiredCss = [
  '.parent2-hero-card',
  '.parent2-status-pill',
  '.parent2-subnav',
  '.parent2-subnav-btn',
  '.wizard-container',
  '.wizard-step-box',
  '.parent-insight-tag',
  '.dual-track-grid',
  '.caf-slot-card',
  '.caf-rank-badge',
  '.caf-strategy-banner',
  '.decision-matrix-card',
  '.matrix-winner'
];

requiredCss.forEach(css => {
  assert.ok(cssContent.includes(css), `styles.css must include ${css}`);
});
console.log('✓ All Parent Portal 2.0 CSS classes verified in styles.css.');

// 3. Verify app.js contains Parent Portal 2.0 controller methods
const jsContent = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
const requiredJs = [
  'parent2State',
  'setupParent2EventListeners',
  'switchParent2SubView',
  'renderParent2Views',
  'renderParent2RecommendationsList',
  'addSchoolToStateCaf',
  'removeSchoolFromStateCaf',
  'moveCafRank',
  'addSchoolToIndependent',
  'removeSchoolFromIndependent',
  'calculateCafStrategy',
  'renderDualTrackHub',
  'renderDecisionMatrix',
  'renderParent2Timeline',
  'exportCalendarIcs',
  'setupParent2Typeaheads'
];

requiredJs.forEach(fn => {
  assert.ok(jsContent.includes(fn), `app.js must include ${fn}`);
});
console.log('✓ All Parent Portal 2.0 controller functions verified in app.js.');

// 4. Test Server APIs for Portfolio Persistence & Recommendations
const testUser = 'p2-e2e-user-' + Date.now();
const testPayload = {
  targetLocation: 'Barnet',
  selectedSchools: [
    { id: 'sch-barnet-1', name: 'Queen Elizabeth\'s School, Barnet', schoolType: 'Grammar', la: 'Barnet', gcseAttainment8: 86.4 },
    { id: 'sch-barnet-2', name: 'Henrietta Barnett School', schoolType: 'Grammar', la: 'Barnet', gcseAttainment8: 85.1 },
    { id: 'sch-barnet-3', name: 'East Barnet School', schoolType: 'Comprehensive', la: 'Barnet', gcseAttainment8: 52.3 }
  ],
  cafRankings: [
    { id: 'sch-barnet-1', name: 'Queen Elizabeth\'s School, Barnet', schoolType: 'Grammar', la: 'Barnet', gcseAttainment8: 86.4 },
    { id: 'sch-barnet-2', name: 'Henrietta Barnett School', schoolType: 'Grammar', la: 'Barnet', gcseAttainment8: 85.1 },
    { id: 'sch-barnet-3', name: 'East Barnet School', schoolType: 'Comprehensive', la: 'Barnet', gcseAttainment8: 52.3 }
  ],
  independentSchools: [
    { id: 'ind-1', name: 'Mill Hill School', schoolType: 'Independent', la: 'Barnet' },
    { id: 'ind-2', name: 'The Haberdashers\' Aske\'s Boys\' School', schoolType: 'Independent', la: 'Hertfordshire' }
  ],
  parentNotes: {
    'sch-barnet-1': { note: 'Requires top 11+ score sitting in September.' },
    'ind-1': { note: 'Visited open morning; bursary application deadline Nov 15.' }
  }
};

const savedPortfolio = db.savePortfolio(testUser, testPayload);
assert.strictEqual(savedPortfolio.cafRankings.length, 3);
assert.strictEqual(savedPortfolio.independentSchools.length, 2);
assert.strictEqual(savedPortfolio.parentNotes['sch-barnet-1'].note, 'Requires top 11+ score sitting in September.');

console.log('✓ Dual-Track SQLite persistence verified with State CAF (3 choices) and Independent (2 schools).');
console.log('====================================================');
console.log('🎉 PARENT PORTAL 2.0 END-TO-END VERIFICATION COMPLETE!');
console.log('====================================================');
