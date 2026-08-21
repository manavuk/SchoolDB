const assert = require('assert');
const db = require('../db');

console.log('--- Testing School Type Simplification & rawSchoolType Preservation ---');

const allowedTypes = new Set(['Grammar', 'Independent', 'Comprehensive']);
const allSchools = db.getAllSchools();

console.log(`Checking ${allSchools.length} schools...`);

let grammarCount = 0;
let independentCount = 0;
let comprehensiveCount = 0;

allSchools.forEach(s => {
  assert(allowedTypes.has(s.schoolType), `School ${s.name} has invalid schoolType: "${s.schoolType}"`);
  assert(s.rawSchoolType !== undefined, `School ${s.name} should have rawSchoolType field`);
  
  if (s.schoolType === 'Grammar') grammarCount++;
  else if (s.schoolType === 'Independent') independentCount++;
  else comprehensiveCount++;
});

console.log(`✓ All ${allSchools.length} schools strictly match allowed types:`);
console.log(`   - Grammar: ${grammarCount}`);
console.log(`   - Independent: ${independentCount}`);
console.log(`   - Comprehensive: ${comprehensiveCount}`);

// Test inserting with subclassification in brackets
const testSchool = {
  id: `test-type-${Date.now()}`,
  name: 'Test Academy High',
  la: 'Barnet',
  schoolType: 'Comprehensive (Academy)',
  ofstedRating: 'Outstanding'
};

const saved = db.insertSchool(testSchool);
assert.strictEqual(saved.schoolType, 'Comprehensive', 'schoolType must be stripped of brackets');
assert.strictEqual(saved.rawSchoolType, 'Comprehensive (Academy)', 'rawSchoolType must preserve original details');

// Clean up
db.deleteSchool(testSchool.id);

console.log('✓ insertSchool strips brackets and preserves rawSchoolType correctly');
console.log('====================================================');
console.log('🎉 ALL SCHOOL TYPE SIMPLIFICATION TESTS PASSED!');
console.log('====================================================');
