const assert = require('assert');
const scannerVerifier = require('./scanner_verifier');
const llmCrawler = require('./llm_crawler');

console.log('=== RUNNING TESTS: HTTP 429 Rate Limit Crawling Stop Guard ===\n');

async function test429Guard() {
  const dummySchool = {
    id: 'test-sch-429-1',
    name: 'St Test Grammar School',
    postcode: 'SW1A 1AA',
    schoolType: 'Grammar',
    gender: 'Mixed'
  };

  // 1. Test LLM Crawler 429 detection with mock response
  console.log('[1. Testing LLM Crawler HTTP 429 Handling]');
  const mock429Fetch = async () => ({
    ok: false,
    status: 429,
    headers: {},
    bodyText: JSON.stringify({
      error: {
        code: 429,
        message: 'Resource has been exhausted (e.g. check quota).',
        status: 'RESOURCE_EXHAUSTED'
      }
    }),
    json: {
      error: {
        code: 429,
        message: 'Resource has been exhausted (e.g. check quota).',
        status: 'RESOURCE_EXHAUSTED'
      }
    }
  });

  const geminiRes = await llmCrawler.crawlSchoolWithGemini(dummySchool, {
    apiKey: 'test-fake-key',
    fetchFn: mock429Fetch
  });

  assert.strictEqual(geminiRes.success, false, 'Gemini response must be unsuccessful on 429');
  assert.strictEqual(geminiRes.isRateLimited, true, 'isRateLimited must be true on 429');
  assert.strictEqual(geminiRes.httpStatus, 429, 'httpStatus must be 429');
  console.log('  ✓ crawlSchoolWithGemini correctly tags isRateLimited: true and httpStatus: 429');

  const chatgptRes = await llmCrawler.crawlSchoolWithChatGPT(dummySchool, {
    apiKey: 'test-fake-key',
    fetchFn: mock429Fetch
  });

  assert.strictEqual(chatgptRes.success, false, 'ChatGPT response must be unsuccessful on 429');
  assert.strictEqual(chatgptRes.isRateLimited, true, 'isRateLimited must be true on 429');
  assert.strictEqual(chatgptRes.httpStatus, 429, 'httpStatus must be 429');
  console.log('  ✓ crawlSchoolWithChatGPT correctly tags isRateLimited: true and httpStatus: 429');

  // 2. Test Scanner Verifier 429 propagation
  console.log('\n[2. Testing Scanner Verifier 429 Propagation]');
  const auditRes = await scannerVerifier.auditAndVerifySchool(dummySchool, {
    apiKey: 'test-fake-key',
    fetchFn: mock429Fetch
  });

  assert.strictEqual(auditRes.isRateLimited, true, 'ScannerVerifier audit must have isRateLimited: true');
  assert.strictEqual(auditRes.status, 'rate_limited', 'Status must be rate_limited');
  assert(auditRes.tags.includes('crawl_rate_limited_429'), 'Tags must include crawl_rate_limited_429');
  console.log('  ✓ scannerVerifier.auditAndVerifySchool correctly tags rate_limited and crawl_rate_limited_429');

  console.log('\n======================================================');
  console.log('🎉 ALL HTTP 429 RATE LIMIT STOPPING TESTS PASSED!');
  console.log('======================================================\n');
}

test429Guard().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
