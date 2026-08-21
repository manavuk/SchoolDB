const assert = require('assert');
const db = require('../db');

console.log('--- Testing Parent Portal 2.0 Backend & Dual-Track Storage ---');

const testUserId = 'test-parent-dualtrack-' + Date.now();

// 1. Test Saving Dual-Track Portfolio
const sampleCafList = [
  { id: 'sch-1', name: 'Tiffin School', schoolType: 'Grammar', la: 'Kingston upon Thames', gcseAttainment8: 82.5 },
  { id: 'sch-2', name: 'Sutton Grammar School', schoolType: 'Grammar', la: 'Sutton', gcseAttainment8: 78.0 },
  { id: 'sch-3', name: 'The Latymer School', schoolType: 'Grammar', la: 'Enfield', gcseAttainment8: 75.4 },
  { id: 'sch-4', name: 'Greig City Academy', schoolType: 'Comprehensive', la: 'Haringey', gcseAttainment8: 48.2 },
  { id: 'sch-5', name: 'Alexandra Park School', schoolType: 'Comprehensive', la: 'Haringey', gcseAttainment8: 62.1 },
  { id: 'sch-6', name: 'Highgate Wood School', schoolType: 'Comprehensive', la: 'Haringey', gcseAttainment8: 51.0 }
];

const sampleIndependentList = [
  { id: 'ind-1', name: 'St Paul\'s School', schoolType: 'Independent', la: 'Richmond upon Thames' },
  { id: 'ind-2', name: 'Westminster School', schoolType: 'Independent', la: 'Westminster' },
  { id: 'ind-3', name: 'Highgate School', schoolType: 'Independent', la: 'Haringey' }
];

const sampleNotes = {
  'sch-1': { note: 'Loved the science building on open day.', openDay: '2026-09-20' },
  'ind-1': { note: 'Bursary form due by 15 November.', bursary: true }
};

const saved = db.savePortfolio(testUserId, {
  targetLocation: 'Haringey',
  selectedSchools: [...sampleCafList, ...sampleIndependentList],
  removedSchoolIds: ['sch-removed-1'],
  cafRankings: sampleCafList,
  independentSchools: sampleIndependentList,
  parentNotes: sampleNotes
});

assert.strictEqual(saved.userId, testUserId);
assert.strictEqual(saved.targetLocation, 'Haringey');
assert.strictEqual(saved.cafRankings.length, 6, 'Should have 6 CAF rankings');
assert.strictEqual(saved.independentSchools.length, 3, 'Should have 3 independent schools');
assert.strictEqual(saved.parentNotes['sch-1'].note, 'Loved the science building on open day.');

console.log('✓ Successfully saved and retrieved Dual-Track Portfolio with CAF rankings & Independent schools.');

// 2. Test Fetching Portfolio via getPortfolioByUserId
const retrieved = db.getPortfolioByUserId(testUserId);
assert.strictEqual(retrieved.cafRankings.length, 6);
assert.strictEqual(retrieved.independentSchools.length, 3);
assert.strictEqual(retrieved.cafRankings[0].name, 'Tiffin School');
assert.strictEqual(retrieved.independentSchools[1].name, 'Westminster School');

console.log('✓ getPortfolioByUserId returns structured cafRankings, independentSchools, and parentNotes.');

// 3. Test Backward Compatibility for Legacy Portfolios
const legacyUserId = 'test-legacy-' + Date.now();
db.savePortfolio(legacyUserId, {
  targetLocation: 'Barnet',
  selectedSchools: [{ id: 'leg-1', name: 'Legacy School', schoolType: 'Comprehensive' }],
  removedSchoolIds: []
});

const legacyRetrieved = db.getPortfolioByUserId(legacyUserId);
assert.ok(Array.isArray(legacyRetrieved.cafRankings), 'cafRankings should default to array');
assert.ok(Array.isArray(legacyRetrieved.independentSchools), 'independentSchools should default to array');
assert.ok(typeof legacyRetrieved.parentNotes === 'object', 'parentNotes should default to object');

console.log('✓ Backward compatibility verified for legacy user portfolios without dual-track columns.');
console.log('🎉 All Parent Portal 2.0 backend tests passed successfully!');
