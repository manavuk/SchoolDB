const assert = require('assert');
const db = require('../db');
const llmCrawler = require('./llm_crawler');

console.log('=== Testing Canonical LLM Query Prompt Template Suite ===');

// Capture initial settings
const initialSettings = db.getAdminSettings();

try {
  const CANONICAL_PREFIX = 'You are an expert UK School Admissions Data Researcher and Verifier.';

  // 1. Verify db.DEFAULT_LLM_PROMPT_TEMPLATE
  console.log('[1. Verifying db.DEFAULT_LLM_PROMPT_TEMPLATE]');
  assert(db.DEFAULT_LLM_PROMPT_TEMPLATE.startsWith(CANONICAL_PREFIX), 'db.DEFAULT_LLM_PROMPT_TEMPLATE must start with canonical prefix');
  console.log('  ✓ db.DEFAULT_LLM_PROMPT_TEMPLATE starts with canonical header.');

  // 2. Verify llmCrawler.DEFAULT_LLM_PROMPT_TEMPLATE
  console.log('\n[2. Verifying llmCrawler.DEFAULT_LLM_PROMPT_TEMPLATE]');
  assert(llmCrawler.DEFAULT_LLM_PROMPT_TEMPLATE.startsWith(CANONICAL_PREFIX), 'llmCrawler.DEFAULT_LLM_PROMPT_TEMPLATE must start with canonical prefix');
  console.log('  ✓ llmCrawler.DEFAULT_LLM_PROMPT_TEMPLATE matches canonical template.');

  // 3. Verify getAdminSettings() loads the canonical template as default
  console.log('\n[3. Verifying db.getAdminSettings() returns canonical template]');
  const currentSettings = db.getAdminSettings();
  assert(currentSettings.llmPromptTemplate.startsWith(CANONICAL_PREFIX), 'Admin settings must return canonical template');
  assert(currentSettings.defaultPromptTemplate.startsWith(CANONICAL_PREFIX), 'Admin settings defaultPromptTemplate must be canonical template');
  console.log('  ✓ db.getAdminSettings() correctly loads canonical template.');

  // 4. Verify fallback when non-canonical template is passed
  console.log('\n[4. Verifying Automatic Reversion on Invalid/Old Template]');
  db.saveAdminSettings({
    llmPromptTemplate: 'Old invalid prompt template that should be replaced'
  });
  const afterSaveSettings = db.getAdminSettings();
  assert(afterSaveSettings.llmPromptTemplate.startsWith(CANONICAL_PREFIX), 'Must fallback to canonical template');
  console.log('  ✓ Non-canonical / legacy templates are automatically reconciled to the master canonical template.');

  // 5. Test llmCrawler.renderPrompt placeholder substitutions
  console.log('\n[5. Verifying Prompt Rendering with Target School]');
  const sampleSchool = {
    name: 'St Paul’s Girls’ School',
    region: 'Greater London',
    la: 'Hammersmith and Fulham',
    postcode: 'W6 7BS',
    website: 'https://spgs.org'
  };
  const renderedPrompt = llmCrawler.renderPrompt(null, sampleSchool);
  assert(renderedPrompt.startsWith(CANONICAL_PREFIX), 'Rendered prompt must start with canonical prefix');
  assert(renderedPrompt.includes('St Paul’s Girls’ School'), 'Must contain school name');
  assert(renderedPrompt.includes('W6 7BS'), 'Must contain postcode');
  assert(renderedPrompt.includes('https://spgs.org'), 'Must contain website URL');
  assert(renderedPrompt.includes('admissionsOverview'), 'Must contain admissionsOverview schema');
  assert(renderedPrompt.includes('registrationFee'), 'Must contain registrationFee schema');
  assert(renderedPrompt.includes('stage_one_examDate'), 'Must contain stage_one_examDate schema');
  console.log('  ✓ renderPrompt accurately populates all school placeholders with canonical template.');

  console.log('\n🎉 ALL CANONICAL PROMPT TEMPLATE TESTS PASSED SUCCESSFULLY!');
} finally {
  // Restore initial settings
  db.saveAdminSettings({
    llmProvider: initialSettings.llmProvider,
    geminiModel: initialSettings.geminiModel,
    geminiApiKey: initialSettings.geminiApiKey || '',
    openaiModel: initialSettings.openaiModel,
    openaiApiKey: initialSettings.openaiApiKey || '',
    scannerSkipDays: initialSettings.scannerSkipDays,
    scannerDelaySeconds: initialSettings.scannerDelaySeconds || 20,
    llmPromptTemplate: db.DEFAULT_LLM_PROMPT_TEMPLATE,
    recWeights: initialSettings.recWeights,
    clearGeminiKey: !initialSettings.geminiApiKey,
    clearOpenaiKey: !initialSettings.openaiApiKey
  });
}
