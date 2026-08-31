const assert = require('assert');
const llmCrawler = require('../scripts/llm_crawler');

console.log('=== Testing LLM Crawler makeJsonPost & Test Connection Suite ===');

// 1. Verify makeJsonPost is exported and is a function
assert.strictEqual(typeof llmCrawler.makeJsonPost, 'function', 'llmCrawler.makeJsonPost must be exported as a function');
console.log('✓ llmCrawler.makeJsonPost is correctly exported as a function.');

// 2. Test makeJsonPost with customFetchFn
async function runTest() {
  const customFetch = async (url, headers, body) => {
    return {
      ok: true,
      status: 200,
      headers: { 'content-type': 'application/json' },
      bodyText: JSON.stringify({ status: 'ok', message: 'Connection verified' }),
      json: { status: 'ok', message: 'Connection verified' }
    };
  };

  const res = await llmCrawler.makeJsonPost(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=AIzaSyTestKey',
    { 'Content-Type': 'application/json' },
    { test: true },
    5000,
    customFetch
  );

  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.status, 'ok');
  console.log('✓ makeJsonPost successfully executed and returned expected payload.');

  console.log('\n🎉 ALL LLM TEST CONNECTION & MAKEJSONPOST TESTS PASSED!');
}

runTest().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
