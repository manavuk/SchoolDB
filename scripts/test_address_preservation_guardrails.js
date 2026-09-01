const assert = require('assert');
const db = require('../db');
const llmCrawler = require('./llm_crawler');
const scannerVerifier = require('./scanner_verifier');

console.log('=== RUNNING TESTS: Address Detail Preservation Guardrails ===\n');

async function runAddressGuardrailTests() {
  const TEST_ID = 'test_addr_guardrail_school_1';

  try {
    // 1. Test shouldUpdateAddress unit logic
    console.log('[1. Testing shouldUpdateAddress Decision Logic]');
    assert.strictEqual(
      llmCrawler.shouldUpdateAddress('10 Church Road, Wimbledon, London SW19 5DQ', 'London'),
      false,
      'Detailed address must NOT be replaced by city name "London"'
    );
    assert.strictEqual(
      llmCrawler.shouldUpdateAddress('Queen Elizabeth Road, Kingston upon Thames', 'Kingston upon Thames'),
      false,
      'Detailed street address must NOT be replaced by town name'
    );
    assert.strictEqual(
      llmCrawler.shouldUpdateAddress('Broadfield Road, Catford, London, SE6 1TJ', 'Catford'),
      false,
      'Full address with postcode must NOT be replaced by borough/town'
    );
    assert.strictEqual(
      llmCrawler.shouldUpdateAddress('London', '10 High Street, Barnet, EN5 5XG'),
      true,
      'Basic city name SHOULD be upgraded by full street address'
    );
    assert.strictEqual(
      llmCrawler.shouldUpdateAddress('', '10 High Street, Barnet, EN5 5XG'),
      true,
      'Empty address SHOULD be populated by full street address'
    );
    assert.strictEqual(
      llmCrawler.shouldUpdateAddress('N/A', '10 High Street, Barnet, EN5 5XG'),
      true,
      'N/A address SHOULD be replaced by full street address'
    );
    assert.strictEqual(
      llmCrawler.shouldUpdateAddress('10 High Street, Barnet', '10 High Street, Barnet, Hertfordshire, EN5 5XG'),
      true,
      'Enriched address with additional county/postcode details SHOULD update'
    );
    console.log('  ✓ All shouldUpdateAddress edge cases evaluated correctly.');

    // 2. Test applyLLMResultToSchool: Attempting to downgrade detailed address to city name
    console.log('\n[2. Testing applyLLMResultToSchool with Basic City Address]');
    db.deleteSchool(TEST_ID);
    const detailedInitialSchool = {
      id: TEST_ID,
      name: 'Guardrail Grammar School',
      schoolType: 'Grammar',
      region: 'Greater London',
      la: 'Kingston upon Thames',
      address: 'Queen Elizabeth Road, Kingston upon Thames, Surrey',
      postcode: 'KT2 6JH',
      phone: '020 8546 5875',
      website: 'https://www.guardrailgrammar.org.uk'
    };
    db.insertSchool(detailedInitialSchool);

    const mockLlmWithBasicAddress = {
      success: true,
      provider: 'gemini',
      model: 'gemini-3.6-flash',
      data: {
        name: 'Guardrail Grammar School',
        address: 'Kingston upon Thames', // Downgraded to just town name
        postcode: 'KT2 6JH',
        entranceExamDates: {
          registrationDeadline: '15 October 2026' // Changed field so LLM has updates
        }
      }
    };

    const applyRes1 = llmCrawler.applyLLMResultToSchool(TEST_ID, mockLlmWithBasicAddress, 'test-admin');
    assert.strictEqual(applyRes1.success, true, 'Update should succeed on other fields');
    
    const dbSchool1 = db.getSchoolById(TEST_ID);
    assert.strictEqual(
      dbSchool1.address,
      'Queen Elizabeth Road, Kingston upon Thames, Surrey',
      'Detailed address MUST remain untouched in SQLite'
    );
    assert(!applyRes1.updatedFields.includes('address'), 'updatedFields must NOT contain address');
    console.log('  ✓ Prevented overwriting detailed address with town name "Kingston upon Thames".');

    // 3. Test applyLLMResultToSchool: Upgrading basic address to full detailed address
    console.log('\n[3. Testing applyLLMResultToSchool with Detailed Address Upgrade]');
    // Update school to have only basic city address
    db.updateSchool(TEST_ID, { address: 'London' });

    const mockLlmWithRichAddress = {
      success: true,
      provider: 'gemini',
      model: 'gemini-3.6-flash',
      data: {
        name: 'Guardrail Grammar School',
        address: '15 Queens Road, Kingston upon Thames, Greater London',
        postcode: 'KT2 7SF'
      }
    };

    const applyRes2 = llmCrawler.applyLLMResultToSchool(TEST_ID, mockLlmWithRichAddress, 'test-admin');
    assert.strictEqual(applyRes2.success, true);
    assert(applyRes2.updatedFields.includes('address'), 'updatedFields MUST contain address when upgraded');
    
    const dbSchool2 = db.getSchoolById(TEST_ID);
    assert.strictEqual(
      dbSchool2.address,
      '15 Queens Road, Kingston upon Thames, Greater London',
      'Basic address MUST be upgraded to detailed address'
    );
    console.log('  ✓ Successfully upgraded basic "London" address to full street address.');

    // 4. Test reconcileLlmSchoolPayload address preservation
    console.log('\n[4. Testing reconcileLlmSchoolPayload Address Preservation]');
    const reconciled = llmCrawler.reconcileLlmSchoolPayload(
      { address: 'London', entranceExamType: 'GL Assessment' },
      { address: '10 Church Road, Wimbledon, London SW19 5DQ' }
    );
    assert.strictEqual(
      reconciled.address,
      '10 Church Road, Wimbledon, London SW19 5DQ',
      'reconciled payload must preserve existing detailed address'
    );
    console.log('  ✓ reconcileLlmSchoolPayload preserved existing detailed address.');

    // 5. Test scannerVerifier.computeSchoolDiff suppression
    console.log('\n[5. Testing scannerVerifier.computeSchoolDiff Suppression]');
    const diffs = scannerVerifier.computeSchoolDiff(
      { address: '10 Church Road, Wimbledon, London SW19 5DQ' },
      { address: 'London' }
    );
    const addressDiff = diffs.find(d => d.field === 'address');
    assert.strictEqual(addressDiff, undefined, 'computeSchoolDiff must NOT report address diff for downgrade');
    console.log('  ✓ computeSchoolDiff successfully suppressed false diff for basic address.');

  } finally {
    db.deleteSchool(TEST_ID);
  }
}

runAddressGuardrailTests().then(() => {
  console.log('\n======================================================');
  console.log('🎉 ALL ADDRESS DETAIL PRESERVATION TESTS PASSED!');
  console.log('======================================================\n');
}).catch(err => {
  console.error('\n❌ Address guardrail test failed:', err);
  process.exit(1);
});
