const assert = require('assert');
const db = require('../db');

console.log('=== Testing Structured Admin Settings Architecture Suite ===');

// 1. Initial Retrieval
const initialSettings = db.getAdminSettings();
console.log('Initial Admin Settings:', {
  llmProvider: initialSettings.llmProvider,
  geminiModel: initialSettings.geminiModel,
  openaiModel: initialSettings.openaiModel,
  scannerSkipDays: initialSettings.scannerSkipDays,
  hasGeminiKey: initialSettings.hasGeminiKey,
  hasOpenaiKey: initialSettings.hasOpenaiKey
});

assert(typeof initialSettings.llmProvider === 'string', 'llmProvider must be string');
assert(typeof initialSettings.geminiModel === 'string', 'geminiModel must be string');
assert(typeof initialSettings.openaiModel === 'string', 'openaiModel must be string');
assert(typeof initialSettings.scannerSkipDays === 'number', 'scannerSkipDays must be number');
assert(typeof initialSettings.recWeights === 'object', 'recWeights must be object');
assert(Array.isArray(initialSettings.supportedGeminiModels), 'supportedGeminiModels must be array');
assert(Array.isArray(initialSettings.supportedOpenaiModels), 'supportedOpenaiModels must be array');

// 2. Test saving and updating settings
const testKeyGemini = 'AIzaSyTestKey_1234567890abcdef';
const testKeyOpenai = 'sk-proj-TestKey_0987654321fedcba';
const customTemplate = db.DEFAULT_LLM_PROMPT_TEMPLATE;

const saved = db.saveAdminSettings({
  llmProvider: 'chatgpt',
  openaiModel: 'gpt-4o',
  geminiModel: 'gemini-3.5-flash-lite',
  geminiApiKey: testKeyGemini,
  openaiApiKey: testKeyOpenai,
  scannerSkipDays: 14,
  llmPromptTemplate: customTemplate,
  recWeights: {
    location: 40,
    examType: 20,
    academicPerformance: 25,
    ofstedRating: 10,
    schoolType: 5
  }
});

console.log('Saved Admin Settings:', {
  llmProvider: saved.llmProvider,
  geminiModel: saved.geminiModel,
  openaiModel: saved.openaiModel,
  scannerSkipDays: saved.scannerSkipDays,
  hasGeminiKey: saved.hasGeminiKey,
  geminiKeyMasked: saved.geminiKeyMasked,
  hasOpenaiKey: saved.hasOpenaiKey,
  openaiKeyMasked: saved.openaiKeyMasked
});

assert.strictEqual(saved.llmProvider, 'chatgpt');
assert.strictEqual(saved.openaiModel, 'gpt-4o');
assert.strictEqual(saved.geminiModel, 'gemini-3.5-flash-lite');
assert.strictEqual(saved.scannerSkipDays, 14);
assert.strictEqual(saved.llmPromptTemplate, customTemplate);
assert.strictEqual(saved.recWeights.location, 40);
assert.strictEqual(saved.recWeights.schoolType, 5);
assert.strictEqual(saved.hasGeminiKey, true);
assert.strictEqual(saved.hasOpenaiKey, true);
assert.strictEqual(saved.geminiKeyMasked, '••••••••cdef');
assert.strictEqual(saved.openaiKeyMasked, '••••••••dcba');
console.log('✓ Full settings save & masking validated.');

// 3. Test partial update (switching provider & model without re-submitting keys)
const partialSaved = db.saveAdminSettings({
  llmProvider: 'gemini',
  geminiModel: 'gemini-3.6-flash'
});

assert.strictEqual(partialSaved.llmProvider, 'gemini');
assert.strictEqual(partialSaved.geminiModel, 'gemini-3.6-flash');
assert.strictEqual(partialSaved.geminiApiKey, testKeyGemini, 'Gemini API key must remain intact');
assert.strictEqual(partialSaved.openaiApiKey, testKeyOpenai, 'OpenAI API key must remain intact');
assert.strictEqual(partialSaved.scannerSkipDays, 14, 'Scanner skip days must remain intact');
assert.strictEqual(partialSaved.llmPromptTemplate, customTemplate, 'Prompt template must remain intact');
console.log('✓ Partial update correctly preserves existing keys and configuration.');

// 4. Test explicit key clearing
const cleared = db.saveAdminSettings({
  clearGeminiKey: true,
  clearOpenaiKey: true
});

assert.strictEqual(cleared.geminiApiKey, '');
assert.strictEqual(cleared.openaiApiKey, '');
assert.strictEqual(cleared.llmProvider, 'gemini');
assert.strictEqual(cleared.scannerSkipDays, 14);
console.log('✓ Key clearing workflow validated.');

// 5. Restore initial settings
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

console.log('\n🎉 ALL STRUCTURED ADMIN SETTINGS TESTS PASSED SUCCESSFULLY!');
