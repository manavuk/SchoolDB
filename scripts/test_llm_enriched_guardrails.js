const assert = require('assert');
const db = require('../db');
const llmCrawler = require('./llm_crawler');
const scannerVerifier = require('./scanner_verifier');

console.log('=== RUNNING TESTS: LLM Enriched Strict Guardrails (Error Protection & Field Updates) ===\n');

async function testGuardrails() {
  const sqlite = db.getDb();
  
  // Create a clean test school
  const testSchoolId = 'test_guardrail_school_001';
  sqlite.prepare(`DELETE FROM schools WHERE id = ?`).run(testSchoolId);
  sqlite.prepare(`DELETE FROM admin_audit_logs WHERE schoolId = ?`).run(testSchoolId);

  db.insertSchool({
    id: testSchoolId,
    name: 'Guardrail Test Grammar School',
    schoolType: 'Grammar',
    gender: 'Boys',
    ageRange: '11 to 18',
    la: 'Barnet',
    region: 'Greater London',
    postcode: 'EN5 4ES',
    website: 'https://www.guardrail-test.sch.uk',
    admissionsPolicy: 'Sit the 11+ test in September.',
    entranceExamType: 'GL Assessment',
    entranceExamDates: JSON.stringify({
      registrationOpen: '1 May 2026',
      registrationDeadline: '1 July 2026'
    }),
    verification_status: 'unverified',
    verification_tags: JSON.stringify(['unscanned'])
  });

  const baseSchool = db.getSchoolById(testSchoolId);
  assert.strictEqual(baseSchool.verification_status, 'unverified');

  // TEST 1: HTTP 429 Rate Limit Error
  console.log('[1. Testing HTTP 429 Rate Limit Error Handling]');
  const rateLimitLlmResult = {
    success: false,
    error: 'RESOURCE_EXHAUSTED',
    message: 'Google Gemini API returned HTTP status 429 (Rate limit / Quota exceeded)',
    provider: 'gemini',
    model: 'gemini-3.6-flash',
    exactResponse: {
      status: 429,
      statusText: '429 Rate Limit',
      rawText: '{"error": {"code": 429, "message": "Quota exceeded for quota metric"}}'
    }
  };

  // Direct applyLLMResultToSchool should reject
  assert.throws(() => {
    llmCrawler.applyLLMResultToSchool(testSchoolId, rateLimitLlmResult);
  }, /Invalid or unsuccessful LLM result cannot be applied/);

  // Full scanner audit with mock 429
  const auditRes429 = await scannerVerifier.auditAndVerifySchool(baseSchool, {
    forceRerun: true,
    mockResponse: {
      success: false,
      error: 'HTTP_429_RATE_LIMIT',
      exactResponse: { status: 429 }
    }
  });

  assert.notStrictEqual(auditRes429.status, 'llm_enriched', 'Status must NOT be llm_enriched on HTTP 429');
  assert(!auditRes429.tags.includes('llm_enriched'), 'Tags must NOT contain llm_enriched on HTTP 429');
  assert(!auditRes429.tags.includes('auto_verified'), 'Tags must NOT contain auto_verified on HTTP 429');

  const dbAfter429 = db.getSchoolById(testSchoolId);
  assert.notStrictEqual(dbAfter429.verification_status, 'llm_enriched', 'DB status must NOT be llm_enriched');
  const dbTags429 = Array.isArray(dbAfter429.verification_tags) ? dbAfter429.verification_tags : JSON.parse(dbAfter429.verification_tags || '[]');
  assert(!dbTags429.includes('llm_enriched'), 'DB tags must NOT include llm_enriched');
  console.log('  ✓ HTTP 429 rate limit safely handled: School is NOT marked as llm_enriched.');

  // TEST 2: General API Error (e.g. 500, Bad Gateway, Network Timeout)
  console.log('\n[2. Testing General LLM API Error Handling]');
  const serverErrorResult = {
    success: false,
    error: 'HTTP_500_INTERNAL_ERROR',
    message: 'OpenAI API returned 500 Internal Server Error',
    provider: 'chatgpt',
    model: 'gpt-4o-mini',
    exactResponse: { status: 500 }
  };

  assert.throws(() => {
    llmCrawler.applyLLMResultToSchool(testSchoolId, serverErrorResult);
  }, /Invalid or unsuccessful LLM result cannot be applied/);

  const auditRes500 = await scannerVerifier.auditAndVerifySchool(baseSchool, {
    forceRerun: true,
    mockResponse: serverErrorResult
  });

  assert.notStrictEqual(auditRes500.status, 'llm_enriched');
  assert(!auditRes500.tags.includes('llm_enriched'));
  const dbAfter500 = db.getSchoolById(testSchoolId);
  const dbTags500 = Array.isArray(dbAfter500.verification_tags) ? dbAfter500.verification_tags : JSON.parse(dbAfter500.verification_tags || '[]');
  assert(!dbTags500.includes('llm_enriched'));
  console.log('  ✓ API 500 error safely handled: School is NOT marked as llm_enriched.');

  // TEST 3: Zero Fields Updated (Identical or Empty Data Returned)
  console.log('\n[3. Testing Zero Fields Added/Updated Handling]');
  // Return data that is completely identical to what is already stored in baseSchool
  const identicalData = {
    schoolName: baseSchool.name,
    schoolType: baseSchool.schoolType,
    gender: baseSchool.gender,
    ageRange: baseSchool.ageRange,
    website: baseSchool.website,
    admissionsPolicy: baseSchool.admissionsPolicy,
    entranceExamType: baseSchool.entranceExamType,
    entranceExamDates: {
      registrationOpen: '1 May 2026',
      registrationDeadline: '1 July 2026'
    }
  };

  const zeroUpdateResult = {
    success: true,
    provider: 'gemini',
    model: 'gemini-3.6-flash',
    data: identicalData
  };

  const applyZeroRes = llmCrawler.applyLLMResultToSchool(testSchoolId, zeroUpdateResult);
  assert.strictEqual(applyZeroRes.success, false, 'applyLLMResultToSchool must return success: false when no fields changed');
  assert.strictEqual(applyZeroRes.reason, 'NO_FIELDS_UPDATED');
  assert.strictEqual(applyZeroRes.updatedFieldsCount, 0);

  const dbAfterZero = db.getSchoolById(testSchoolId);
  assert.notStrictEqual(dbAfterZero.verification_status, 'llm_enriched', 'DB status must remain unverified when no fields changed');
  const dbTagsZero = Array.isArray(dbAfterZero.verification_tags) ? dbAfterZero.verification_tags : JSON.parse(dbAfterZero.verification_tags || '[]');
  assert(!dbTagsZero.includes('llm_enriched'), 'Tags must NOT have llm_enriched when no fields changed');
  console.log('  ✓ Zero field changes detected: School is NOT marked as llm_enriched.');

  // TEST 4: At Least One Field Added or Updated -> Successful llm_enriched Application
  console.log('\n[4. Testing Successful Field Addition/Update -> Marks llm_enriched]');
  const updatedData = {
    schoolName: baseSchool.name,
    entranceExamDates: {
      registrationOpen: '1 May 2026',
      registrationDeadline: '1 July 2026',
      stage_one_examDate: '15 September 2026', // NEW FIELD!
      stage_one_format_and_subjects: 'Maths & English (GL Assessment)' // NEW FIELD!
    },
    national_rank_england: 14 // NEW FIELD!
  };

  const validUpdateResult = {
    success: true,
    provider: 'gemini',
    model: 'gemini-3.6-flash',
    data: updatedData
  };

  const applySuccessRes = llmCrawler.applyLLMResultToSchool(testSchoolId, validUpdateResult);
  assert.strictEqual(applySuccessRes.success, true, 'Must succeed when fields are updated');
  assert.strictEqual(applySuccessRes.updated, true);
  assert(applySuccessRes.updatedFieldsCount >= 1, 'Must have at least 1 updated field');
  assert(applySuccessRes.tags.includes('llm_enriched'), 'Must include llm_enriched tag');

  const dbAfterSuccess = db.getSchoolById(testSchoolId);
  assert.strictEqual(dbAfterSuccess.verification_status, 'llm_enriched');
  const dbTagsSuccess = Array.isArray(dbAfterSuccess.verification_tags) ? dbAfterSuccess.verification_tags : JSON.parse(dbAfterSuccess.verification_tags || '[]');
  assert(dbTagsSuccess.includes('llm_enriched'), 'DB tags must include llm_enriched');
  assert.strictEqual(dbAfterSuccess.national_rank_england, 14, 'Ranking field must be persisted');
  console.log(`  ✓ Successfully updated ${applySuccessRes.updatedFieldsCount} field(s) (${applySuccessRes.updatedFields.join(', ')}): School marked as llm_enriched.`);

  // Cleanup test school
  sqlite.prepare(`DELETE FROM schools WHERE id = ?`).run(testSchoolId);
  sqlite.prepare(`DELETE FROM admin_audit_logs WHERE schoolId = ?`).run(testSchoolId);

  console.log('\n======================================================');
  console.log('🎉 ALL LLM ENRICHED GUARDRAIL TESTS PASSED!');
  console.log('======================================================\n');
}

testGuardrails().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
