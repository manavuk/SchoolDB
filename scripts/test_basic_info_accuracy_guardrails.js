const assert = require('assert');
const db = require('../db');
const llmCrawler = require('./llm_crawler');

console.log('=== RUNNING TESTS: Basic School Information & Gender Accuracy Guardrails ===\n');

async function testBasicInfoAccuracy() {
  const TEST_ID = 'test_jameah_gender_guardrail';

  try {
    // 1. Verify Prompt Templates
    console.log('[1. Testing Prompt Template Zero-Guesswork Directives]');
    assert(
      db.DEFAULT_LLM_PROMPT_TEMPLATE.includes('ZERO GUESSWORK ON BASIC INFO'),
      'db prompt template must forbid guesswork on basic info'
    );
    assert(
      db.DEFAULT_LLM_PROMPT_TEMPLATE.includes('NEVER default to "Mixed" or guess the gender policy'),
      'db prompt template must forbid defaulting gender to Mixed'
    );
    assert(
      llmCrawler.DEFAULT_LLM_PROMPT_TEMPLATE.includes('ZERO GUESSWORK ON BASIC INFO'),
      'llmCrawler prompt template must forbid guesswork on basic info'
    );
    assert(
      llmCrawler.DEFAULT_LLM_PROMPT_TEMPLATE.includes('NEVER default to "Mixed" or guess the gender policy'),
      'llmCrawler prompt template must forbid defaulting gender to Mixed'
    );
    console.log('  ✓ Prompt templates contain explicit zero-guesswork rules for gender and basic info.');

    // 2. Test Jameah Academy Scenario: Protecting Single-Sex Girls from Default Mixed Flip
    console.log('\n[2. Testing Single-Sex Protection Against Unverified Mixed Guess]');
    db.deleteSchool(TEST_ID);
    const jameahSchool = {
      id: TEST_ID,
      name: 'Jameah Academy',
      schoolType: 'Independent',
      gender: 'Girls',
      la: 'Leicester',
      region: 'East Midlands',
      postcode: 'LE5 3SD'
    };
    db.insertSchool(jameahSchool);

    // Mock LLM response with unverified Mixed guess and null website / low confidence
    const unverifiedLlmResponse = {
      success: true,
      provider: 'gemini',
      model: 'gemini-3.5-flash-lite',
      data: {
        name: 'Jameah Academy',
        gender: 'Mixed', // Hallucinated default
        website: null,
        confidenceScore: 80,
        entranceExamDates: {
          registrationDeadline: '1 December 2026'
        }
      }
    };

    const applyRes1 = llmCrawler.applyLLMResultToSchool(TEST_ID, unverifiedLlmResponse, 'test-admin');
    assert.strictEqual(applyRes1.success, true);
    
    const dbSchool1 = db.getSchoolById(TEST_ID);
    assert.strictEqual(
      dbSchool1.gender,
      'Girls',
      'School gender MUST remain "Girls" and NOT be flipped to "Mixed" by unverified LLM response'
    );
    assert(!applyRes1.updatedFields.includes('gender'), 'updatedFields must NOT contain gender');
    console.log('  ✓ Successfully protected single-sex "Girls" school from erroneous "Mixed" flip.');

    // 3. Test High Confidence Verified Transition
    console.log('\n[3. Testing Verified High-Confidence Transition]');
    const verifiedLlmResponse = {
      success: true,
      provider: 'gemini',
      model: 'gemini-3.6-flash',
      data: {
        name: 'Jameah Academy',
        gender: 'Mixed',
        website: 'https://www.jameahacademy.org',
        confidenceScore: 98,
        entranceExamDates: {
          registrationDeadline: '5 December 2026'
        }
      }
    };

    const applyRes2 = llmCrawler.applyLLMResultToSchool(TEST_ID, verifiedLlmResponse, 'test-admin');
    assert.strictEqual(applyRes2.success, true);
    assert(applyRes2.updatedFields.includes('gender'), 'Verified high-confidence transition allows update');
    
    const dbSchool2 = db.getSchoolById(TEST_ID);
    assert.strictEqual(dbSchool2.gender, 'Mixed');
    console.log('  ✓ Verified high-confidence transition with official website succeeded.');

  } finally {
    db.deleteSchool(TEST_ID);
  }
}

testBasicInfoAccuracy().then(() => {
  console.log('\n======================================================');
  console.log('🎉 ALL BASIC INFO & GENDER ACCURACY TESTS PASSED!');
  console.log('======================================================\n');
}).catch(err => {
  console.error('\n❌ Test failed:', err);
  process.exit(1);
});
