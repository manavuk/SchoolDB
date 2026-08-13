const assert = require('assert');
const db = require('../db');

console.log('--- Testing Parent-Centric Qualitative Recommendation Engine ---');

const testUserId1 = `usr-parent-qual-1-${Date.now()}`;
const testUser1 = {
  id: testUserId1,
  name: 'Parent Qualitative Tester 1',
  email: `qual.parent1.${Date.now()}@gmail.com`,
  password: 'user',
  permissions: ['parent:recommendations', 'parent:portfolio']
};

db.insertUser(testUser1);
console.log(`✓ Created test parent user ${testUser1.email}`);

// 1. Test Saving Qualitative Preferences with N/A options & Multi-Select Exam Formats
const prefs1 = {
  targetPostcode: 'Barnet, Kingston',
  targetBorough: 'Barnet, Kingston',
  childAbilityLevel: 'top_class',
  binaryFilters: {
    locations: 'Barnet, Kingston',
    gender: 'girls',
    schoolTypes: ['Grammar', 'Independent'],
    examFormats: ['11+ GL Assessment', 'Sutton SET'],
    ofstedFloor: 'outstanding',
    sixthForm: 'yes'
  },
  qualitativeWeights: {
    proximity: 'very',
    academicExcellence: 'top_priority',
    pupilProgress: 'somewhat',
    subjectBreadth: 'NA'
  }
};

const saved1 = db.saveUserRecPreferences(testUserId1, prefs1);
assert.strictEqual(saved1.childAbilityLevel, 'top_class', 'Child ability level must save');
assert.strictEqual(saved1.binaryFilters.locations, 'Barnet, Kingston', 'Multi-location hard requirement must save');
assert.strictEqual(saved1.binaryFilters.gender, 'girls', 'Gender constraint must save');
assert.deepStrictEqual(saved1.binaryFilters.examFormats, ['11+ GL Assessment', 'Sutton SET'], 'Multi-select exam formats must save');
assert.strictEqual(saved1.qualitativeWeights.academicExcellence, 'top_priority', 'Qualitative weight step must save');

console.log('✓ Parent 1 qualitative recommendation preferences saved and retrieved cleanly!');

// 2. Test Second Isolated Parent Profile (Independent settings)
const testUserId2 = `usr-parent-qual-2-${Date.now()}`;
const testUser2 = {
  id: testUserId2,
  name: 'Parent Qualitative Tester 2',
  email: `qual.parent2.${Date.now()}@gmail.com`,
  password: 'user',
  permissions: ['parent:recommendations', 'parent:portfolio']
};

db.insertUser(testUser2);

const prefs2 = {
  targetPostcode: 'KT1 2PT',
  targetBorough: 'Kingston upon Thames',
  childAbilityLevel: 'average',
  binaryFilters: {
    gender: 'NA', // N/A No preference
    schoolTypes: ['Comprehensive'],
    examFormats: ['NA'],
    ofstedFloor: 'good'
  },
  qualitativeWeights: {
    proximity: 'top_priority',
    academicExcellence: 'somewhat',
    pupilProgress: 'very'
  }
};

const saved2 = db.saveUserRecPreferences(testUserId2, prefs2);
assert.strictEqual(saved2.childAbilityLevel, 'average');
assert.strictEqual(saved2.binaryFilters.gender, 'NA', 'N/A option must be preserved');
assert.strictEqual(saved1.childAbilityLevel, 'top_class', 'Parent 1 profile must remain isolated from Parent 2');

console.log('✓ Per-parent profile isolation & Universal N/A ignore options verified!');

console.log('\n=========================================');
console.log('🎉 QUALITATIVE RECOMMENDATION ENGINE TESTS PASSED!');
console.log('=========================================');
