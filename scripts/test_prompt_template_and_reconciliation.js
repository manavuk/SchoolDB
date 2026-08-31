const assert = require('assert');
const db = require('../db');
const llmCrawler = require('../scripts/llm_crawler');
const scannerVerifier = require('../scripts/scanner_verifier');

console.log('=== Testing Updated Default Prompt Template & Field Reconciliation Suite ===');

// 1. Verify Default Template contents
const defaultTemplate = db.DEFAULT_LLM_PROMPT_TEMPLATE;
console.log('[1. Verifying Default Prompt Template]');
assert(defaultTemplate.includes('admissionsOverview') && defaultTemplate.includes('bullet points'), 'Must ask for 11+ admission process overview in bullet points');
assert(defaultTemplate.includes('"admissionsOverview"'), 'Must specify admissionsOverview in JSON schema');
assert(defaultTemplate.includes('"rawSchoolType"'), 'Must specify rawSchoolType in JSON schema');
assert(defaultTemplate.includes('"description"'), 'Must specify description in JSON schema');
assert(defaultTemplate.includes('"ageRange"'), 'Must specify ageRange in JSON schema');
assert(defaultTemplate.includes('"entranceExamDates"'), 'Must specify entranceExamDates in JSON schema');
assert(defaultTemplate.includes('"feesTermly"'), 'Must specify feesTermly in JSON schema');
assert(defaultTemplate.includes('"registrationFee"'), 'Must specify registrationFee in JSON schema');
assert(defaultTemplate.includes('registration fee'), 'Must include registration fee in instructions');
assert(defaultTemplate.includes('multi-date') || defaultTemplate.includes('multiple examination dates'), 'Must include instruction for returning multiple dates as array');
console.log('  ✓ Default prompt template verified with full 11+ admissions overview instructions and JSON schema.');

// 2. Test reconciliation function with diverse / mismatched payload formats
console.log('\n[2. Testing reconcileLlmSchoolPayload Field Normalization]');
const mockLlmRawResponse = {
  name: 'Tiffin School',
  schoolTypeDetail: 'Grammar (Selective Academy)',
  schoolType: 'Grammar',
  gender: 'Boys',
  age_range: '11 to 18',
  summary: 'A leading selective state grammar school in Kingston upon Thames.',
  admissions_overview: '• Stage 1: Sit the Stage 1 Test (English & Maths) in October.\n• Stage 2: Top scorers invited to Stage 2 examination in November.\n• Catchment: Prioritises boys living in the designated inner catchment area.\n• Offers: National Offer Day on 1 March.',
  examBoard: 'School’s Own Test (Stage 1 & Stage 2)',
  entranceExamDates: {
    registrationOpens: '2 June 2026',
    registrationCloses: '1 September 2026',
    firstExamDate: ['1 October 2026', '2 October 2026'],
    firstExamSubjects: 'English & Mathematics Multiple Choice Papers',
    firstExamResults: '15 October 2026',
    secondStageRequired: 'Yes',
    secondExamDate: ['12 November 2026', '13 November 2026'],
    secondExamSubjects: 'English Comprehension & Extended Writing, Maths Problem Solving',
    interviewsDate: ['18 January 2027', '19 January 2027', '20 January 2027'],
    offersDate: '1 March 2027',
    offerAcceptByDate: '16 March 2027',
    openDayEvening: 'Open Evening on 8 July 2026'
  },
  examRegistrationFee: '£150 (Non-refundable examination fee)',
  termlyFees: 'N/A (State Funded)',
  verificationSource: 'https://www.tiffinschool.co.uk/admissions/year-7/'
};

const reconciled = llmCrawler.reconcileLlmSchoolPayload(mockLlmRawResponse);
console.log('Reconciled Payload Output:', {
  admissionsPolicy: reconciled.admissionsPolicy,
  rawSchoolType: reconciled.rawSchoolType,
  ageRange: reconciled.ageRange,
  description: reconciled.description,
  entranceExamType: reconciled.entranceExamType,
  registrationFee: reconciled.registrationFee,
  milestones: reconciled.entranceExamDates,
  sourceUrl: reconciled.sourceUrl
});

assert.strictEqual(reconciled.rawSchoolType, 'Grammar (Selective Academy)');
assert.strictEqual(reconciled.gender, 'Boys');
assert.strictEqual(reconciled.ageRange, '11 to 18');
assert.strictEqual(reconciled.entranceExamType, 'School’s Own Test (Stage 1 & Stage 2)');
assert.strictEqual(reconciled.registrationFee, '£150 (Non-refundable examination fee)');
assert(reconciled.admissionsPolicy.includes('• Stage 1: Sit the Stage 1 Test'), 'Formatted bullet text must be preserved in admissionsPolicy');
assert(reconciled.admissionsPolicy.includes('• Catchment: Prioritises boys'), 'Formatted bullet text must be preserved in admissionsPolicy');

// Multi-date array assertions
assert(Array.isArray(reconciled.entranceExamDates.stage_one_examDate), 'stage_one_examDate must be array');
assert.deepStrictEqual(reconciled.entranceExamDates.stage_one_examDate, ['1 October 2026', '2 October 2026']);

assert(Array.isArray(reconciled.entranceExamDates.stage_two_examDate), 'stage_two_examDate must be array');
assert.deepStrictEqual(reconciled.entranceExamDates.stage_two_examDate, ['12 November 2026', '13 November 2026']);

assert(Array.isArray(reconciled.entranceExamDates.interviewDates), 'interviewDates must be array');
assert.deepStrictEqual(reconciled.entranceExamDates.interviewDates, ['18 January 2027', '19 January 2027', '20 January 2027']);

// Single date string assertions
assert.strictEqual(typeof reconciled.entranceExamDates.registrationOpen, 'string');
assert.strictEqual(reconciled.entranceExamDates.registrationOpen, '2 June 2026');
assert.strictEqual(reconciled.entranceExamDates.registrationDeadline, '1 September 2026');
assert.strictEqual(reconciled.entranceExamDates.offerDate, '1 March 2027');
assert.strictEqual(reconciled.entranceExamDates.acceptanceDeadline, '16 March 2027');
assert.strictEqual(reconciled.sourceUrl, 'https://www.tiffinschool.co.uk/admissions/year-7/');
console.log('  ✓ Reconciled multi-date arrays and single date scalars seamlessly.');

// 3. Test applying to database and validating stored fields
console.log('\n[3. Testing Database Persistence & Formatted Text Storage]');
const allSchools = db.getAllSchools();
const targetSchool = allSchools[0];
assert(targetSchool, 'Need at least one school in database');

const mockLlmResult = {
  success: true,
  provider: 'gemini',
  model: 'gemini-3.5-flash-lite',
  schoolId: targetSchool.id,
  data: {
    name: targetSchool.name,
    rawSchoolType: 'Independent Day & Boarding School (11–18)',
    schoolType: 'Independent',
    gender: 'Mixed',
    ageRange: '11 to 18',
    description: 'Premier independent co-educational school with strong academic and co-curricular programs.',
    admissionsOverview: '• Online Registration: Complete registration before 13 November 2026.\n• Stage 1 Assessment: ISEB Common Pre-Test taken in late November or early December.\n• Stage 2 & Interview: Shortlisted candidates attend group assessment and interview on 9 January 2027.\n• Offers Released: 12 February 2027 with acceptance due 5 March 2027.',
    entranceExamType: 'ISEB Common Pre-Test & School Assessment',
    entranceExamDates: {
      registrationOpen: '1 May 2026',
      registrationDeadline: '13 November 2026',
      registrationFee: '£175',
      stage_one_examDate: ['1 December 2026', '2 December 2026'],
      stage_one_format_and_subjects: 'ISEB Pre-Test (English, Mathematics, Verbal & Non-Verbal Reasoning)',
      stage_one_resultDate: '18 December 2026',
      second_stage_exam_required: 'Yes',
      stage_two_examDate: ['9 January 2027', '10 January 2027'],
      stage_two_format_and_subjects: 'Creative Writing & Maths Problem Solving',
      interviewDates: ['15 January 2027', '16 January 2027'],
      offerDate: '12 February 2027',
      acceptanceDeadline: '5 March 2027',
      scholarshipsOffered: 'Academic, Music, Art, Drama, and Sport Scholarships',
      bursaryDeadline: '13 November 2026'
    },
    feesTermly: '£8,250',
    registrationFee: '£175',
    confidenceScore: 98,
    sourceUrl: 'https://test-school.org.uk/admissions-2027'
  }
};

const applyRes = llmCrawler.applyLLMResultToSchool(targetSchool.id, mockLlmResult, 'Test Automation Suite');
assert(applyRes.success, 'applyLLMResultToSchool should succeed');

const updatedSchool = db.getSchoolById(targetSchool.id);
console.log('Updated School Record in DB:', {
  id: updatedSchool.id,
  name: updatedSchool.name,
  schoolType: updatedSchool.schoolType,
  rawSchoolType: updatedSchool.rawSchoolType,
  gender: updatedSchool.gender,
  ageRange: updatedSchool.ageRange,
  admissionsPolicy: updatedSchool.admissionsPolicy,
  entranceExamType: updatedSchool.entranceExamType,
  entranceExamDates: updatedSchool.entranceExamDates,
  feesTermly: updatedSchool.feesTermly,
  registrationFee: updatedSchool.registrationFee,
  sourceUrl: updatedSchool.sourceUrl,
  confidenceScore: updatedSchool.confidence_score
});

assert(updatedSchool.admissionsPolicy.includes('• Online Registration: Complete registration'), 'admissionsPolicy must store formatted bullet overview');
assert(updatedSchool.admissionsPolicy.includes('• Stage 1 Assessment: ISEB Common Pre-Test'), 'admissionsPolicy must preserve formatting in DB');
assert.strictEqual(updatedSchool.rawSchoolType, 'Independent Day & Boarding School (11–18)');
assert.strictEqual(updatedSchool.ageRange, '11 to 18');
assert.strictEqual(updatedSchool.entranceExamType, 'ISEB Common Pre-Test & School Assessment');
assert.strictEqual(updatedSchool.feesTermly, '£8,250');
assert.strictEqual(updatedSchool.registrationFee, '£175');
assert.strictEqual(updatedSchool.sourceUrl, 'https://test-school.org.uk/admissions-2027');

// Verify DB parsed entranceExamDates array persistence
const parsedDbDates = typeof updatedSchool.entranceExamDates === 'string' ? JSON.parse(updatedSchool.entranceExamDates) : updatedSchool.entranceExamDates;
assert(Array.isArray(parsedDbDates.stage_one_examDate), 'DB entranceExamDates.stage_one_examDate must be array');
assert.deepStrictEqual(parsedDbDates.stage_one_examDate, ['1 December 2026', '2 December 2026']);
assert(Array.isArray(parsedDbDates.stage_two_examDate), 'DB entranceExamDates.stage_two_examDate must be array');
assert.deepStrictEqual(parsedDbDates.stage_two_examDate, ['9 January 2027', '10 January 2027']);
assert(Array.isArray(parsedDbDates.interviewDates), 'DB entranceExamDates.interviewDates must be array');
assert.deepStrictEqual(parsedDbDates.interviewDates, ['15 January 2027', '16 January 2027']);
assert.strictEqual(typeof parsedDbDates.offerDate, 'string');
assert.strictEqual(parsedDbDates.offerDate, '12 February 2027');

console.log('  ✓ Stored formatted text, admission process bullets, and multi-date arrays in SQLite database.');

console.log('\n🎉 ALL PROMPT TEMPLATE & FIELD RECONCILIATION TESTS PASSED!');
