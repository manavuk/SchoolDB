const assert = require('assert');
const db = require('../db');

console.log('--- Testing School Details API & GCSE Subjects Normalization ---');

const allSchools = db.getAllSchools();
const schoolsWithSubjects = allSchools.filter(s => Array.isArray(s.gcseSubjects) && s.gcseSubjects.length > 0);

assert.ok(schoolsWithSubjects.length > 0, "At least one school must have cataloged GCSE subjects");

// 1. Fetch first sample school with GCSE subjects
const sampleSchool1 = db.getSchoolById(schoolsWithSubjects[0].id);
console.log("✓ Loaded Sample School 1:", sampleSchool1.name);

assert.ok(sampleSchool1, "Sample school 1 must exist in SQLite");
assert.ok(Array.isArray(sampleSchool1.gcseSubjects), "gcseSubjects must be normalized to an Array in db.js");
console.log(`✓ ${sampleSchool1.name} GCSE Subjects Count: ${sampleSchool1.gcseSubjects.length}`);
console.log('  Subjects:', sampleSchool1.gcseSubjects.slice(0, 5));

// 2. Fetch second sample school
if (schoolsWithSubjects.length > 1) {
  const sampleSchool2 = db.getSchoolById(schoolsWithSubjects[1].id);
  console.log("\n✓ Loaded Sample School 2:", sampleSchool2.name);

  assert.ok(sampleSchool2, "Sample school 2 must exist in SQLite");
  assert.ok(Array.isArray(sampleSchool2.gcseSubjects), "gcseSubjects must be normalized to an Array in db.js");
  console.log(`✓ ${sampleSchool2.name} GCSE Subjects Count: ${sampleSchool2.gcseSubjects.length}`);
  console.log('  Subjects:', sampleSchool2.gcseSubjects.slice(0, 5));
}

console.log('\n=========================================');
console.log('🎉 SCHOOL DETAILS MODAL TESTS PASSED!');
console.log('=========================================');
