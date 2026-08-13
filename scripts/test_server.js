const db = require('../db');
const assert = require('assert');

console.log('--- Verification Test for SQLite Integration ---');

// 1. Verify Schools querying & search filter
const allSchools = db.getAllSchools();
console.log(`Total schools in SQLite database: ${allSchools.length}`);
assert(allSchools.length > 3000, 'Schools count should be > 3000');

const filteredGrammar = allSchools.filter(s => s.schoolType && s.schoolType.toLowerCase().includes('grammar'));
console.log(`Grammar schools count: ${filteredGrammar.length}`);

const searchResult = allSchools.filter(s => (s.name && s.name.toLowerCase().includes('tiffin')));
console.log(`Schools matching "tiffin": ${searchResult.map(s => s.name).join(', ')}`);
assert(searchResult.length > 0, 'Should find Tiffin schools');

// 2. Verify Single school fetch & insert & update & delete
const testSchool = {
  id: `sch-test-${Date.now()}`,
  name: 'Test Academy SQLite',
  urn: '999999',
  la: 'Kingston upon Thames',
  schoolType: 'Academy Converter',
  gender: 'Mixed',
  pupilCount: 850
};
db.insertSchool(testSchool);
let fetchedTest = db.getSchoolById(testSchool.id);
assert.strictEqual(fetchedTest.name, 'Test Academy SQLite');
console.log(`✓ Inserted & verified test school: ${fetchedTest.id}`);

db.updateSchool(testSchool.id, { pupilCount: 900 });
fetchedTest = db.getSchoolById(testSchool.id);
assert.strictEqual(fetchedTest.pupilCount, 900);
console.log(`✓ Updated & verified pupilCount to 900`);

db.deleteSchool(testSchool.id);
assert.strictEqual(db.getSchoolById(testSchool.id), null);
console.log(`✓ Deleted test school successfully`);

// 3. Verify Users
const admin = db.getUserByEmail('admin@edulondon.sch.uk');
assert(admin && Array.isArray(admin.permissions), 'User account must exist with permissions array');
console.log(`✓ User account verified: ${admin.email}`);

// 4. Verify Portfolios
const sarahP = db.getPortfolioByUserId('parent-sarah');
assert(sarahP && sarahP.selectedSchools.length > 0, 'Sarah portfolio must exist with schools');
console.log(`✓ Portfolio verified for parent-sarah (${sarahP.selectedSchools.length} schools, location: ${sarahP.targetLocation})`);

// 5. Verify Rec Settings
const settings = db.getRecSettings();
assert(settings && settings.weights, 'Rec settings weights verified');
console.log(`✓ Rec settings verified:`, settings.weights);

console.log('\n=========================================');
console.log('🎉 ALL INTEGRATION VERIFICATION TESTS PASSED!');
console.log('=========================================');
