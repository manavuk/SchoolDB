const assert = require('assert');
const db = require('../db');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

console.log('--- Testing Schools Gap Reconciliation & Independent Primary Key Integrity ---');

// 1. Primary Key Integrity
const schools = db.getAllSchools();
console.log(`✓ Total schools loaded: ${schools.length}`);
assert(schools.length >= 6000, `Expected >= 6000 schools, found ${schools.length}`);

const idSet = new Set();
for (const s of schools) {
  assert(s.id && typeof s.id === 'string' && s.id.trim().length > 0, `School must have a valid string primary key id (found ${s.id})`);
  assert(!idSet.has(s.id), `School primary key id must be unique (duplicate: ${s.id})`);
  idSet.add(s.id);
}
console.log(`✓ All ${schools.length} schools have strictly unique, non-null primary keys (id).`);

// 2. Independent Primary Key Verification (id != urn)
let hasIndependentKeyPattern = 0;
let hasPrefixedKeyPattern = 0;
for (const s of schools) {
  if (s.id.startsWith('sch-gov-')) hasPrefixedKeyPattern++;
  else if (s.id.startsWith('sch-')) hasIndependentKeyPattern++;
}
console.log(`✓ Primary Key Distribution: ${hasIndependentKeyPattern} legacy sch-XXXXX keys, ${hasPrefixedKeyPattern} gov-ingested sch-gov-XXXXXX keys.`);
assert(hasIndependentKeyPattern > 0 && hasPrefixedKeyPattern > 0, 'Both primary key structures should exist and not be raw URNs.');

// 3. Test insertSchool auto-generates primary key if not supplied
const generatedSchool = db.insertSchool({
  name: 'Test Auto PK High School',
  urn: '99988877',
  la: 'Barnet',
  schoolType: 'Comprehensive'
});
assert(generatedSchool.id && generatedSchool.id.startsWith('sch-gov-99988877'), 'Auto-generated ID should follow sch-gov-URN pattern');
console.log(`✓ insertSchool auto-generated PK for missing id: ${generatedSchool.id}`);

// Clean up test school
db.deleteSchool(generatedSchool.id);
assert(!db.getSchoolById(generatedSchool.id), 'Test school should be deleted');

// 4. Secondary School Gap Coverage Verification
const rawDb = new DatabaseSync(path.join(__dirname, '../data/schooldb.sqlite'));
const unmatchedGovOpenSec = rawDb.prepare(`
  SELECT count(*) as count 
  FROM all_schools_gov g 
  WHERE (g.ISSECONDARY = '1' OR g.ISSECONDARY = 1)
    AND g.SCHSTATUS = 'Open' 
    AND g.URN NOT IN (SELECT urn FROM schools WHERE urn IS NOT NULL AND TRIM(urn) != '')
`).get().count;

console.log(`✓ Unmatched open secondary schools in all_schools_gov: ${unmatchedGovOpenSec}`);
assert.strictEqual(unmatchedGovOpenSec, 0, 'All open secondary schools from all_schools_gov should now be present in schools table');

console.log('====================================================');
console.log('🎉 ALL GAP RECONCILIATION & PRIMARY KEY TESTS PASSED!');
console.log('====================================================');
