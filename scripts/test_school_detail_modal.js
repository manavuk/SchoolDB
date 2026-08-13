const assert = require('assert');
const db = require('../db');

console.log('--- Testing School Details API & GCSE Subjects Normalization ---');

// 1. Fetch Queen's Gate School (sch-385461)
const qgSchool = db.getSchoolById('sch-385461');
console.log("✓ Loaded Queen's Gate School:", qgSchool.name);

assert.ok(qgSchool, "Queen's Gate School must exist in SQLite");
assert.ok(Array.isArray(qgSchool.gcseSubjects), "gcseSubjects must be normalized to an Array in db.js");
console.log(`✓ Queen's Gate GCSE Subjects Count: ${qgSchool.gcseSubjects.length}`);
console.log('  Subjects:', qgSchool.gcseSubjects);

// 2. Fetch Notting Hill and Ealing High School GDST (sch-517326)
const nhSchool = db.getSchoolById('sch-517326');
console.log("\n✓ Loaded Notting Hill and Ealing High School GDST:", nhSchool.name);

assert.ok(nhSchool, "Notting Hill School must exist in SQLite");
assert.ok(Array.isArray(nhSchool.gcseSubjects), "gcseSubjects must be normalized to an Array in db.js");
console.log(`✓ Notting Hill GCSE Subjects Count: ${nhSchool.gcseSubjects.length}`);
console.log('  Subjects:', nhSchool.gcseSubjects);

console.log('\n=========================================');
console.log('🎉 SCHOOL DETAILS MODAL TESTS PASSED!');
console.log('=========================================');
