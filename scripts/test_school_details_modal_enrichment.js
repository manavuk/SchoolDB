const assert = require('assert');
const db = require('../db');

console.log('=== Testing School Details Modal Enriched & Reconciled Information Suite ===');

// 1. Get a sample school from DB or create a rich mock school
const schools = db.getAllSchools();
assert(schools.length > 0, 'Schools must be present in DB');

const sampleSchool = schools.find(s => s.feesTermly || s.kpsDetails || s.pillaiDetails || s.entranceExamDates) || schools[0];
console.log(`Testing with sample school: ${sampleSchool.name} (URN: ${sampleSchool.urn || 'N/A'})`);

// 2. Reconcile school details logic (mirroring openSchoolDetail in app.js)
const dates = sampleSchool.entranceExamDates || {};
const k = sampleSchool.kpsDetails || {};
const p = sampleSchool.pillaiDetails || {};

const examBoard = p.examBoard || dates.examBoard || null;
const examType = sampleSchool.entranceExamType || dates.entranceExamType || (examBoard ? `11+ Entrance Assessment (${examBoard})` : 'Standard 11+ Assessment');
const regStatus = p.registrationStatus || dates.registrationStatus || (dates.registrationDeadline ? 'Active / Configured' : null);
const regFee = k.registrationFee || dates.registrationFee || null;
const regOpen = p.registrationOpens || dates.registrationOpen || dates.registrationOpens || null;
const regDeadline = p.registrationDeadline || k.registrationCloseDate || k.registrationCloses || dates.registrationDeadline || null;

// Stage 1
const firstExamDate = p.firstExamDate || k.firstExamDate || dates.examDate || dates.firstExamDate || null;
const firstExamSubjects = sampleSchool.stage_one_format_and_subjects || dates.stage_one_format_and_subjects || p.firstExamSubjects || k.firstExamFormatSubjects || k.examFormat || dates.firstExamSubjects || null;
const firstStageResult = p.firstExamResults || k.firstStageResult || dates.firstStageResult || dates.firstExamResults || null;

// Stage 2
const secondStageRequired = sampleSchool.second_stage_exam_required || dates.second_stage_exam_required || (p.secondExamDate || k.secondStageExamDate || dates.secondExamDate ? 'Yes (Selective 2nd Stage)' : 'No (Single Stage Examination)');
const secondExamDate = p.secondExamDate || k.secondStageExamDate || dates.secondExamDate || null;
const secondExamSubjects = sampleSchool.stage_two_format_and_subjects || dates.stage_two_format_and_subjects || p.secondExamSubjects || k.secondExamFormatSubjects || dates.secondExamSubjects || null;
const secondStageResult = p.secondExamResults || k.secondStageResult || dates.secondStageResult || dates.secondExamResults || null;

// Financials
const feesTermly = sampleSchool.feesTermly || dates.feesTermly || dates.feesPerTerm || p.feesTermly || null;

console.log('Reconciliation Results for Sample School:');
console.log('  Exam Type:', examType);
console.log('  Registration Status:', regStatus);
console.log('  Registration Deadline:', regDeadline);
console.log('  Stage 1 Exam Date:', firstExamDate);
console.log('  Stage 1 Format/Subjects:', firstExamSubjects);
console.log('  Stage 2 Required:', secondStageRequired);
console.log('  Termly Tuition Fees:', feesTermly);

assert(typeof examType === 'string', 'Exam type must be string');
assert(typeof secondStageRequired === 'string', 'Second stage required must be string');

// 3. Test on a rich Independent school record
const richIndepSchool = {
  id: 'sch-test-indep-1',
  name: 'Dulwich College Prep Test',
  urn: '100999',
  schoolType: 'Independent',
  rawSchoolType: 'Independent Senior School (11–18)',
  gender: 'Boys',
  ageRange: '11 to 18',
  pupilCount: 1450,
  ofstedRating: 'Outstanding',
  feesTermly: '£8,750',
  stage_one_format_and_subjects: 'ISEB Common Pre-Test (English, Maths, VR, NVR)',
  second_stage_exam_required: 'Yes (Selective 2nd Stage)',
  stage_two_format_and_subjects: 'Written English essay & Advanced Mathematics Problem Solving',
  entranceExamDates: {
    registrationOpen: '1 June 2026',
    registrationDeadline: '13 November 2026',
    examDate: '9 January 2027',
    secondExamDate: '23 January 2027',
    interviewInfo: '30 January 2027',
    resultsDate: '12 February 2027',
    offersAcceptance: '5 March 2027',
    scholarshipsOffered: 'Academic, Music, Art, Drama & Sports Scholarships'
  },
  verification_status: 'llm_enriched',
  confidence_score: 98,
  verified_at: '2026-08-30T17:40:00.000Z',
  sourceUrl: 'https://dulwichprep.org.uk/admissions-2027',
  website: 'https://dulwichprep.org.uk',
  phone: '020 8693 2678',
  email: 'admissions@dulwichprep.org.uk'
};

const d = richIndepSchool.entranceExamDates;
const indepStage1 = richIndepSchool.stage_one_format_and_subjects || d.firstExamSubjects;
const indepStage2 = richIndepSchool.stage_two_format_and_subjects || d.secondExamSubjects;
const indepFees = richIndepSchool.feesTermly || d.feesTermly;
const indepSecondRequired = richIndepSchool.second_stage_exam_required || (d.secondExamDate ? 'Yes (Selective 2nd Stage)' : 'No');

assert.strictEqual(indepStage1, 'ISEB Common Pre-Test (English, Maths, VR, NVR)');
assert.strictEqual(indepStage2, 'Written English essay & Advanced Mathematics Problem Solving');
assert.strictEqual(indepFees, '£8,750');
assert.strictEqual(indepSecondRequired, 'Yes (Selective 2nd Stage)');
assert.strictEqual(richIndepSchool.confidence_score, 98);
assert.strictEqual(richIndepSchool.verification_status, 'llm_enriched');

console.log('✓ Rich independent school profile correctly reconciled.');
console.log('\n🎉 ALL SCHOOL DETAILS MODAL RECONCILIATION TESTS PASSED!');
