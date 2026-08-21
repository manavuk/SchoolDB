const assert = require('assert');
const db = require('../db');

console.log('--- Testing bulkUpdateSchools Database Function ---');

const allSchools = db.getAllSchools();
assert(allSchools.length > 5, 'Should have schools in db');

const sampleIds = [allSchools[0].id, allSchools[1].id];
const origTypes = [allSchools[0].schoolType, allSchools[1].schoolType];

// Test bulk updating hot badge
const updated = db.bulkUpdateSchools(sampleIds, { hot: true });
assert.strictEqual(updated.length, 2, 'Should update 2 schools');
assert.strictEqual(Boolean(db.getSchoolById(sampleIds[0]).hot), true, 'School 0 should be hot');
assert.strictEqual(Boolean(db.getSchoolById(sampleIds[1]).hot), true, 'School 1 should be hot');

// Revert test changes
db.bulkUpdateSchools(sampleIds, { hot: allSchools[0].hot, schoolType: origTypes[0] });

console.log('✓ Bulk update SQLite transaction tests passed successfully!');
