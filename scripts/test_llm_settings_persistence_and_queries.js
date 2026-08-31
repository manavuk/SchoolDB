const assert = require('assert');
const db = require('../db');
const scannerVerifier = require('../scripts/scanner_verifier');
const llmCrawler = require('../scripts/llm_crawler');

console.log('=== Comprehensive LLM Provider, Model & API Key Persistence Test ===');

// 1. Capture initial settings
const initialSettings = db.getAdminSettings();

db.saveSystemSettings({
  llmProvider: 'gemini',
  geminiModel: 'gemini-3.6-flash',
  openaiModel: 'gpt-4o-mini',
  geminiApiKey: 'AIzaSy_Mock_Gemini_Key_123',
  openaiApiKey: 'sk-proj_Mock_OpenAI_Key_456',
  scannerSkipDays: 10,
  llmPromptTemplate: db.DEFAULT_LLM_PROMPT_TEMPLATE
});

let settings = db.getSystemSettings();
assert.strictEqual(settings.llmProvider, 'gemini');
assert.strictEqual(settings.geminiModel, 'gemini-3.6-flash');
assert.strictEqual(settings.openaiModel, 'gpt-4o-mini');
assert.strictEqual(settings.geminiApiKey, 'AIzaSy_Mock_Gemini_Key_123');
assert.strictEqual(settings.openaiApiKey, 'sk-proj_Mock_OpenAI_Key_456');
console.log('✓ Initial settings configured and verified.');

// 2. Switch provider to OpenAI ChatGPT and select model gpt-4o
db.saveSystemSettings({
  llmProvider: 'chatgpt',
  openaiModel: 'gpt-4o'
});

settings = db.getSystemSettings();
assert.strictEqual(settings.llmProvider, 'chatgpt', 'Provider must be chatgpt');
assert.strictEqual(settings.openaiModel, 'gpt-4o', 'OpenAI model must be gpt-4o');
assert.strictEqual(settings.geminiModel, 'gemini-3.6-flash', 'Gemini model must be preserved');
assert.strictEqual(settings.geminiApiKey, 'AIzaSy_Mock_Gemini_Key_123', 'Gemini key must not be erased');
assert.strictEqual(settings.openaiApiKey, 'sk-proj_Mock_OpenAI_Key_456', 'OpenAI key must not be erased');
console.log('✓ Section 1 provider and model switch persisted without affecting keys.');

// 3. Run mock single school query with LLM Crawler
const mockSchool = {
  id: 'test_school_persistence_1',
  name: 'St Pauls Test School',
  region: 'London',
  website: 'https://stpaulstest.org.uk'
};

(async () => {
  try {
    const mockCrawlerRes = await llmCrawler.crawlSchoolWithLLM(mockSchool, {
      mockResponse: {
        name: 'St Pauls Test School',
        website: 'https://stpaulstest.org.uk',
        confidenceScore: 99,
        entranceExamDates: {
          examDate: '2026-11-15'
        }
      }
    });

    assert.strictEqual(mockCrawlerRes.success, true);
    assert.strictEqual(mockCrawlerRes.provider, 'chatgpt', 'Crawl must use the active provider (chatgpt)');
    assert.strictEqual(mockCrawlerRes.model, 'gpt-4o', 'Crawl must use active model (gpt-4o)');

    // 4. Verify settings AFTER query execution to ensure NO settings were reset
    const afterQuerySettings = db.getSystemSettings();
    assert.strictEqual(afterQuerySettings.llmProvider, 'chatgpt', 'Provider must stay chatgpt after query');
    assert.strictEqual(afterQuerySettings.openaiModel, 'gpt-4o', 'OpenAI model must stay gpt-4o after query');
    assert.strictEqual(afterQuerySettings.geminiModel, 'gemini-3.6-flash', 'Gemini model must stay gemini-3.6-flash');
    assert.strictEqual(afterQuerySettings.geminiApiKey, 'AIzaSy_Mock_Gemini_Key_123', 'Gemini API key must not reset after query');
    assert.strictEqual(afterQuerySettings.openaiApiKey, 'sk-proj_Mock_OpenAI_Key_456', 'OpenAI API key must not reset after query');
    console.log('✓ Verified: Settings and API keys remain 100% persisted after query execution.');

    // 5. Switch to Gemini, update Gemini model to gemini-3.5-flash-lite, and test again
    db.saveSystemSettings({
      llmProvider: 'gemini',
      geminiModel: 'gemini-3.5-flash-lite'
    });

    const geminiQueryRes = await llmCrawler.crawlSchoolWithLLM(mockSchool, {
      mockResponse: {
        name: 'St Pauls Test School',
        website: 'https://stpaulstest.org.uk',
        confidenceScore: 98,
        entranceExamDates: {
          examDate: '2026-11-20'
        }
      }
    });

    assert.strictEqual(geminiQueryRes.success, true);
    assert.strictEqual(geminiQueryRes.provider, 'gemini');
    assert.strictEqual(geminiQueryRes.model, 'gemini-3.5-flash-lite');

    const finalSettings = db.getSystemSettings();
    assert.strictEqual(finalSettings.llmProvider, 'gemini');
    assert.strictEqual(finalSettings.geminiModel, 'gemini-3.5-flash-lite');
    assert.strictEqual(finalSettings.openaiModel, 'gpt-4o');
    assert.strictEqual(finalSettings.geminiApiKey, 'AIzaSy_Mock_Gemini_Key_123');
    assert.strictEqual(finalSettings.openaiApiKey, 'sk-proj_Mock_OpenAI_Key_456');
    console.log('✓ Section 1 provider switch to Gemini + gemini-3.5-flash-lite verified & persistent.');

    // Restore initial settings
    db.saveAdminSettings({
      llmProvider: initialSettings.llmProvider,
      geminiModel: initialSettings.geminiModel,
      geminiApiKey: initialSettings.geminiApiKey || '',
      openaiModel: initialSettings.openaiModel,
      openaiApiKey: initialSettings.openaiApiKey || '',
      scannerSkipDays: initialSettings.scannerSkipDays,
      llmPromptTemplate: initialSettings.llmPromptTemplate,
      recWeights: initialSettings.recWeights,
      clearGeminiKey: !initialSettings.geminiApiKey,
      clearOpenaiKey: !initialSettings.openaiApiKey
    });

    console.log('\n✅ ALL LLM PROVIDER, MODEL & API KEY PERSISTENCE TESTS PASSED SUCCESSFULLY!');
  } catch (err) {
    console.error('❌ Test failed:', err);
    process.exit(1);
  }
})();
