const assert = require('assert');
const llmCrawler = require('./llm_crawler');

console.log('--- Testing Sequential LLM Query Execution & 10s Rate-Limit Pacing ---');

// 1. Test renderPrompt structure
const sampleSchool = {
  id: 'test_school_1',
  name: 'Dulwich Prep London',
  postcode: 'SE21 7AA',
  la: 'Southwark',
  region: 'Greater London',
  website: 'https://www.dulwichpreplondon.org'
};

const rendered = llmCrawler.renderPrompt(null, sampleSchool);
assert(rendered.includes('Dulwich Prep London'), 'Rendered prompt must contain school name');
assert(rendered.includes('SE21 7AA'), 'Rendered prompt must contain postcode');
console.log('✓ Prompt rendering contains target school name and details.');

// 2. Test 429 Rate-Limit Retry Handling
let fetchAttempts = 0;
const mockRateLimitThenSuccessFetch = async (url, headers, body) => {
  fetchAttempts++;
  if (fetchAttempts === 1) {
    // Return 429 on first attempt
    return {
      ok: false,
      status: 429,
      statusText: '429 Too Many Requests',
      bodyText: JSON.stringify({ error: { code: 429, message: 'RESOURCE_EXHAUSTED: Rate limit exceeded' } }),
      json: { error: { code: 429, message: 'RESOURCE_EXHAUSTED: Rate limit exceeded' } }
    };
  } else {
    // Return valid response on retry
    const validData = {
      schoolName: 'Dulwich Prep London',
      entranceExamType: 'ISEB Pre-Test',
      entranceExamDates: {
        registrationDeadline: '2026-11-01',
        examDate: '2027-01-12',
        offerDate: '2027-02-15'
      },
      confidenceScore: 95
    };
    return {
      ok: true,
      status: 200,
      statusText: '200 OK',
      bodyText: JSON.stringify(validData, null, 2),
      json: validData
    };
  }
};

(async () => {
  console.log('Testing 429 Rate-Limit retry behavior (with mocked fetch)...');
  const startTime = Date.now();
  const result = await llmCrawler.crawlSchoolWithGemini(sampleSchool, {
    apiKey: 'dummy_key',
    fetchFn: mockRateLimitThenSuccessFetch
  });

  const duration = Date.now() - startTime;
  console.log(`Crawl completed in ${duration}ms, fetch attempts: ${fetchAttempts}`);
  assert.strictEqual(fetchAttempts, 2, 'Should have retried after 429');
  assert(duration >= 9800, `Should have paused ~10 seconds before retry (took ${duration}ms)`);
  assert.strictEqual(result.success, true, 'Result should succeed on second attempt');
  assert.strictEqual(result.data.schoolName, 'Dulwich Prep London');
  console.log('✓ 429 Rate limit triggered 10-second backoff and succeeded on retry!');

  console.log('====================================================');
  console.log('🎉 ALL SEQUENTIAL & PACING TESTS PASSED PERFECTLY!');
  console.log('====================================================');
})();
