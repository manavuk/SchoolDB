const assert = require('assert');
const db = require('../db');
const scannerVerifier = require('./scanner_verifier');
const llmCrawler = require('./llm_crawler');
const fs = require('fs');
const path = require('path');

console.log('=== RUNNING TESTS: Data Enrichment Verified Matching Fields & Live Feed ===\n');

// 1. Testing computeVerifiedMatches in scanner_verifier
console.log('[1. Testing computeVerifiedMatches]');
const previousSchool = {
  id: 'test-sch-vm-1',
  name: 'St Pauls Grammar School',
  website: 'https://www.stpaulsgrammar.co.uk',
  entranceExamType: '11+ GL Assessment',
  gender: 'Boys',
  phone: '020 8123 4567',
  email: 'admissions@stpaulsgrammar.co.uk',
  postcode: 'SW13 9ER',
  feesTermly: '£7,500',
  registrationFee: '£150',
  entranceExamDates: JSON.stringify({
    registrationOpen: '1 May 2026',
    registrationDeadline: '30 September 2026',
    stage_one_examDate: '15 November 2026'
  })
};

const queryResultData = {
  website: 'https://www.stpaulsgrammar.co.uk/',
  entranceExamType: '11+ GL Assessment',
  gender: 'Boys',
  phone: '(020) 8123 4567',
  email: 'ADMISSIONS@STPAULSGRAMMAR.CO.UK',
  postcode: 'SW13 9ER',
  feesTermly: '£7,500',
  registrationFee: '£150',
  entranceExamDates: {
    registrationOpen: '1 May 2026',
    registrationDeadline: '30 September 2026',
    stage_one_examDate: '15 November 2026'
  }
};

const matches = scannerVerifier.computeVerifiedMatches(previousSchool, queryResultData);
assert(Array.isArray(matches), 'computeVerifiedMatches must return an array');
assert(matches.length >= 6, `Expected at least 6 verified matching field groups, got ${matches.length}`);

const datesMatch = matches.find(m => m.field === 'entranceExamDates');
assert(datesMatch, 'Must match entranceExamDates');
assert.strictEqual(datesMatch.verifiedDates.length, 3, 'Must have 3 verified date milestones');

const websiteMatch = matches.find(m => m.field === 'website');
assert(websiteMatch, 'Must match website');

const phoneMatch = matches.find(m => m.field === 'phone');
assert(phoneMatch, 'Must match phone');

console.log('  ✓ computeVerifiedMatches correctly extracted matching non-null attributes');

// 2. Testing auditAndVerifySchool with matching non-null query
console.log('\n[2. Testing auditAndVerifySchool with Matching Query]');
(async () => {
  // Insert test school
  const testId = `sch-enrich-match-${Date.now()}`;
  db.insertSchool({
    id: testId,
    name: 'Verified Match Grammar School',
    schoolType: 'Grammar',
    la: 'Barnet',
    website: 'https://www.verifiedmatch.co.uk',
    entranceExamType: '11+ CEM Format',
    gender: 'Girls',
    phone: '020 8999 1111',
    entranceExamDates: {
      registrationOpen: '1 June 2026',
      registrationDeadline: '15 October 2026'
    }
  });

  const schoolInDb = db.getSchoolById(testId);

  const mockMatchingLlmResponse = {
    schoolName: 'Verified Match Grammar School',
    website: 'https://www.verifiedmatch.co.uk',
    entranceExamType: '11+ CEM Format',
    gender: 'Girls',
    phone: '020 8999 1111',
    entranceExamDates: {
      registrationOpen: '1 June 2026',
      registrationDeadline: '15 October 2026'
    },
    confidenceScore: 98
  };

  const auditResult = await scannerVerifier.auditAndVerifySchool(schoolInDb, {
    mockResponse: JSON.stringify(mockMatchingLlmResponse),
    forceRerun: true
  });

  assert(auditResult, 'Must return auditResult');
  assert.strictEqual(auditResult.status, 'auto_verified', 'Status must be auto_verified when query matches non-null data');
  assert(auditResult.verifiedMatches && auditResult.verifiedMatches.length > 0, 'Must record verifiedMatches');
  assert(auditResult.tags.includes('auto_verified'), 'Tags must include auto_verified');
  assert(auditResult.confidenceScore >= 95, 'Confidence score must be boosted for confirmed match');

  const updatedSchool = db.getSchoolById(testId);
  assert.strictEqual(updatedSchool.verification_status, 'auto_verified', 'DB record must be marked auto_verified');

  // Clean up
  db.deleteSchool(testId);
  console.log('  ✓ auditAndVerifySchool marked school verified/enriched and saved auto_verified status');

  // 3. Testing UI code in app.js
  console.log('\n[3. Testing Live Feed UI rendering in public/js/app.js]');
  const appJs = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
  assert(appJs.includes('Verified Matching Non-Null Fields'), 'app.js must render verified matching fields section');
  assert(appJs.includes('Enriched / Verified'), 'app.js must display Enriched / Verified badge');
  assert(appJs.includes('Verified Match'), 'app.js must render Verified Match status pill');
  console.log('  ✓ Verified Matching fields table and status pill found in public/js/app.js');

  console.log('\n======================================================');
  console.log('🎉 ALL DATA ENRICHMENT VERIFIED FIELDS TESTS PASSED!');
  console.log('======================================================\n');
})();
