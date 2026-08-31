const assert = require('assert');
const db = require('../db');

console.log('--- Testing Redesigned Admin LLM Settings Persistence Suite ---');

// 1. Test getSystemSettings defaults
const initialSettings = db.getSystemSettings();
console.log('Initial settings:', {
  llmProvider: initialSettings.llmProvider,
  geminiModel: initialSettings.geminiModel,
  openaiModel: initialSettings.openaiModel,
  scannerSkipDays: initialSettings.scannerSkipDays,
  hasTemplate: Boolean(initialSettings.llmPromptTemplate)
});

assert.strictEqual(typeof initialSettings.llmProvider, 'string', 'Provider should be string');
assert.strictEqual(typeof initialSettings.scannerSkipDays, 'number', 'scannerSkipDays should be number');
assert.strictEqual(typeof initialSettings.llmPromptTemplate, 'string', 'llmPromptTemplate should be string');

// 2. Test saving custom LLM settings
const customTemplate = db.DEFAULT_LLM_PROMPT_TEMPLATE;
const updated = db.saveSystemSettings({
  llmProvider: 'chatgpt',
  geminiModel: 'gemini-3.5-flash-lite',
  openaiModel: 'gpt-4o',
  geminiApiKey: 'AIzaSy_Secret_Test_Key_12345',
  openaiApiKey: 'sk-proj-Secret_Test_Key_67890',
  scannerSkipDays: 14,
  llmPromptTemplate: customTemplate
});

assert.strictEqual(updated.llmProvider, 'chatgpt', 'Provider should be chatgpt');
assert.strictEqual(updated.geminiModel, 'gemini-3.5-flash-lite', 'Gemini model should be gemini-3.5-flash-lite');
assert.strictEqual(updated.openaiModel, 'gpt-4o', 'OpenAI model should be gpt-4o');
assert.strictEqual(updated.geminiApiKey, 'AIzaSy_Secret_Test_Key_12345', 'Gemini API key should be saved');
assert.strictEqual(updated.openaiApiKey, 'sk-proj-Secret_Test_Key_67890', 'OpenAI API key should be saved');
assert.strictEqual(updated.scannerSkipDays, 14, 'scannerSkipDays should be 14');
assert.strictEqual(updated.llmPromptTemplate, customTemplate, 'Prompt template should be persisted');
console.log('✓ Custom settings saved and retrieved correctly.');

// 3. Test partial update (e.g. changing model should NOT erase API keys or template)
const partialUpdate = db.saveSystemSettings({
  openaiModel: 'o3-mini'
});

assert.strictEqual(partialUpdate.openaiModel, 'o3-mini', 'OpenAI model should be o3-mini');
assert.strictEqual(partialUpdate.geminiApiKey, 'AIzaSy_Secret_Test_Key_12345', 'Gemini API key must be preserved');
assert.strictEqual(partialUpdate.openaiApiKey, 'sk-proj-Secret_Test_Key_67890', 'OpenAI API key must be preserved');
assert.strictEqual(partialUpdate.llmPromptTemplate, customTemplate, 'Prompt template must be preserved');
console.log('✓ Partial updates correctly preserve existing keys and prompt templates.');

// 4. Test resetting prompt template
const resetSettings = db.saveSystemSettings({
  llmPromptTemplate: db.DEFAULT_LLM_PROMPT_TEMPLATE,
  llmProvider: 'gemini',
  geminiModel: 'gemini-3.6-flash',
  openaiModel: 'gpt-4o-mini',
  scannerSkipDays: 10
});

assert.strictEqual(resetSettings.llmPromptTemplate, db.DEFAULT_LLM_PROMPT_TEMPLATE, 'Prompt template reset to default');
assert.strictEqual(resetSettings.llmProvider, 'gemini');
assert.strictEqual(resetSettings.geminiModel, 'gemini-3.6-flash');
console.log('✓ Resetting to default template verified.');

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

console.log('All Admin Settings tests passed successfully!');
