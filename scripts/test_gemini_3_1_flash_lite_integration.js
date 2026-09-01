const assert = require('assert');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const llmCrawler = require('./llm_crawler');

console.log('=== RUNNING TESTS: Gemini 3.1 Flash Lite Model Integration ===\n');

async function testGemini31Integration() {
  const initialSettings = db.getAdminSettings();

  try {
    // 1. Check SUPPORTED_GEMINI_MODELS in db.js
    console.log('[1. Verifying db.SUPPORTED_GEMINI_MODELS]');
    assert(db.SUPPORTED_GEMINI_MODELS.includes('gemini-3.1-flash-lite'), 'SUPPORTED_GEMINI_MODELS must include gemini-3.1-flash-lite');
    console.log('  ✓ db.SUPPORTED_GEMINI_MODELS contains gemini-3.1-flash-lite.');

    // 2. Check public/index.html options
    console.log('\n[2. Verifying public/index.html Dropdown Options]');
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    assert(html.includes('value="gemini-3.1-flash-lite"'), 'index.html must have gemini-3.1-flash-lite option');
    console.log('  ✓ public/index.html contains gemini-3.1-flash-lite option.');

    // 3. Check Settings Persistence & Retrieval
    console.log('\n[3. Testing Admin Settings Persistence with gemini-3.1-flash-lite]');
    db.saveAdminSettings({
      geminiModel: 'gemini-3.1-flash-lite'
    });
    const updatedSettings = db.getAdminSettings();
    assert.strictEqual(updatedSettings.geminiModel, 'gemini-3.1-flash-lite', 'geminiModel must be saved and loaded as gemini-3.1-flash-lite');
    console.log('  ✓ Admin settings correctly persists and loads gemini-3.1-flash-lite.');

    // 4. Test API Crawl with gemini-3.1-flash-lite
    console.log('\n[4. Testing Live API Crawl Dispatch with gemini-3.1-flash-lite]');
    const sampleSchool = {
      id: 'test_sample_school',
      name: 'St Paul’s Girls’ School',
      city: 'London',
      county: 'Greater London',
      postcode: 'W6 7BS',
      website: 'https://spgs.org'
    };

    const mockFetcher = async (url, headers, body) => {
      return {
        ok: true,
        status: 200,
        statusText: '200 OK',
        json: {
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  name: 'St Paul’s Girls’ School',
                  gender: 'Girls',
                  schoolType: 'Independent',
                  confidenceScore: 98
                })
              }]
            }
          }]
        }
      };
    };

    const crawlRes = await llmCrawler.crawlSchoolWithGemini(sampleSchool, {
      model: 'gemini-3.1-flash-lite',
      fetchFn: mockFetcher
    });

    assert.strictEqual(crawlRes.success, true, 'Crawl must return success: true');
    assert.strictEqual(crawlRes.exactResponse?.status, 200, 'API status must be 200 OK');
    assert.strictEqual(crawlRes.exactRequest?.model, 'gemini-3.1-flash-lite', 'Exact model must be gemini-3.1-flash-lite');
    console.log('  ✓ Crawl with gemini-3.1-flash-lite succeeded with 200 OK and correct model targeting.');

  } finally {
    db.saveAdminSettings({
      geminiModel: initialSettings.geminiModel,
      geminiApiKey: initialSettings.geminiApiKey || ''
    });
  }
}

testGemini31Integration().then(() => {
  console.log('\n======================================================');
  console.log('🎉 ALL GEMINI 3.1 FLASH LITE TESTS PASSED!');
  console.log('======================================================\n');
}).catch(err => {
  console.error('\n❌ Gemini 3.1 Flash Lite integration test failed:', err);
  process.exit(1);
});
