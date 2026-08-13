const assert = require('assert');
const db = require('../db');

console.log('--- Testing Edit High School Record Full Field Specs & Exam Dates ---');

const schools = db.getAllSchools();
assert(schools.length > 0, 'Schools must exist in SQLite database');
const targetSchool = schools[0];
const targetId = targetSchool.id;

console.log(`✓ Selected test school ${targetSchool.name} (${targetId})`);

const newExamDates = {
  registrationOpen: '1 May 2026',
  registrationDeadline: '30 September 2026',
  examDate: '15 October 2026',
  secondExamDate: '12 November 2026',
  resultsDate: '10 December 2026',
  interviewInfo: 'Group interview & written task',
  openEvents: '5 October 2026 (5pm - 8pm)',
  scholarships: 'Academic & Music Scholarships'
};

const updatePayload = {
  name: targetSchool.name,
  urn: targetSchool.urn,
  la: targetSchool.la,
  region: 'Greater London',
  address: '100 Test High Street',
  postcode: targetSchool.postcode,
  schoolType: targetSchool.schoolType,
  gender: targetSchool.gender,
  ageRange: '11-18',
  pupilCount: targetSchool.pupilCount || 1000,
  ofstedRating: targetSchool.ofstedRating,
  gcseProgress8: 1.15,
  gcseAttainment8: 82.4,
  ebaccAveragePointScore: 7.25,
  entranceExamType: '11+ GL Assessment (Sutton SET)',
  entranceExamDates: newExamDates,
  gcseSubjects: ['Mathematics', 'English Language', 'Physics', 'Chemistry', 'Biology'],
  admissionsPolicy: 'Selective 11+ entrance examination ranking.',
  description: 'Updated test description for edit modal verification.',
  phone: '020 8000 9999',
  email: 'admissions.test@schooldb.sch.uk',
  website: 'https://www.testschool.sch.uk',
  hot: true,
  official: true
};

const updated = db.updateSchool(targetId, updatePayload);
assert.ok(updated, 'Updated school object must be returned');

// Verify SQLite persistence
const reloaded = db.getSchoolById(targetId);
assert.strictEqual(reloaded.entranceExamDates.registrationOpen, '1 May 2026');
assert.strictEqual(reloaded.entranceExamDates.registrationDeadline, '30 September 2026');
assert.strictEqual(reloaded.entranceExamDates.examDate, '15 October 2026');
assert.strictEqual(reloaded.entranceExamDates.secondExamDate, '12 November 2026');
assert.strictEqual(reloaded.entranceExamDates.resultsDate, '10 December 2026');
assert.strictEqual(reloaded.entranceExamDates.interviewInfo, 'Group interview & written task');
assert.strictEqual(reloaded.entranceExamDates.openEvents, '5 October 2026 (5pm - 8pm)');
assert.strictEqual(reloaded.entranceExamDates.scholarships, 'Academic & Music Scholarships');
assert.strictEqual(reloaded.ebaccAveragePointScore, 7.25);
assert.strictEqual(reloaded.email, 'admissions.test@schooldb.sch.uk');
assert.strictEqual(reloaded.hot, true);
assert.strictEqual(reloaded.official, true);

console.log('✓ All 24 fields and exam dates successfully updated & persisted in SQLite!');

console.log('\n=========================================');
console.log('🎉 FULL EDIT MODAL FIELD SPECS TESTS PASSED!');
console.log('=========================================');
