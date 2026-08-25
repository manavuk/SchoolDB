const assert = require('assert');
const db = require('../db');

console.log('--- Testing NA Second Exam & Interview Date Anomaly Filtering ---');

// Test Case 1: School with valid dates where secondExamDate is 'NA' and interviewInfo is 'N/A'
const testSchool1 = {
  id: 'test-na-1',
  name: 'Test NA School',
  schoolType: 'Independent',
  entranceExamDates: JSON.stringify({
    registrationOpen: '1 June 2026',
    registrationDeadline: '6 November 2026',
    examDate: '9 January 2027',
    secondExamDate: 'NA',
    resultsDate: '12 February 2027',
    interviewInfo: 'N/A',
    offersAcceptance: '5 March 2027'
  })
};

const result1 = db.analyzeSchoolAdmissionDates(testSchool1);
console.log('Test 1 Result:', result1 ? { qualityScore: result1.qualityScore, anomalies: result1.anomalies } : null);
assert(result1, 'Should analyze school');
assert.strictEqual(result1.anomalies.length, 0, 'Must have 0 anomalies when secondExamDate is NA and interview is N/A');
assert.strictEqual(result1.qualityScore, 90, 'Quality score must be 90% (clean)');

// Test Case 2: Various NA representations ('none', 'n.a.', 'Not Applicable', '—', null)
const naVariations = ['NA', 'na', 'N/A', 'n/a', 'n.a.', 'None', 'none', '—', '-', 'Not Applicable', null, undefined];

for (const v of naVariations) {
  const school = {
    id: `test-na-${v}`,
    name: `Test NA School (${v})`,
    schoolType: 'Grammar',
    entranceExamDates: JSON.stringify({
      registrationOpen: '1 May 2026',
      registrationDeadline: '3 July 2026',
      examDate: '12 September 2026',
      secondExamDate: v,
      resultsDate: '16 October 2026',
      interviewInfo: v,
      offersAcceptance: '15 March 2027'
    })
  };

  const res = db.analyzeSchoolAdmissionDates(school);
  assert(res, `Should analyze school for variation ${v}`);
  assert.strictEqual(res.anomalies.length, 0, `Variation "${v}" must produce 0 anomalies`);
  assert.strictEqual(res.qualityScore, 90, `Variation "${v}" must have 90% quality score`);
}

console.log('✓ All NA representations (NA, N/A, n.a., None, Not Applicable, —, null) verified to produce 0 anomalies.');

// Test Case 3: Verify full database scan
const fullScan = db.getAllDateAnomalies();
console.log('Full Database Anomaly Stats:', fullScan.stats);
assert.strictEqual(fullScan.stats.totalAnomalies, 0, 'Database should have 0 anomalies');
console.log('✓ Full database verified with 0 anomalies.');

console.log('====================================================');
console.log('🎉 ALL NA DATE ANOMALY FILTERING TESTS PASSED!');
console.log('====================================================');
