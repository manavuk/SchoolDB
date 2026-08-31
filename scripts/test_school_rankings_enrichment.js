const assert = require('assert');
const db = require('../db');
const llmCrawler = require('./llm_crawler');

console.log('=== RUNNING TESTS: School Rankings in England (Overall, GCSE & A-Level) ===\n');

async function runTests() {
  const sqlite = db.getDb();

  // 1. Verify Database Schema & Columns
  console.log('[1. Testing SQLite Schema & Columns]');
  const tableInfo = sqlite.prepare("PRAGMA table_info('schools')").all();
  const columnNames = tableInfo.map(c => c.name);

  assert(columnNames.includes('national_rank_england'), 'Column national_rank_england must exist in schools table');
  assert(columnNames.includes('gcse_rank_england'), 'Column gcse_rank_england must exist in schools table');
  assert(columnNames.includes('a_level_rank_england'), 'Column a_level_rank_england must exist in schools table');
  console.log('  ✓ Verified national_rank_england, gcse_rank_england, and a_level_rank_england columns in schools table.');

  // 2. Verify Prompt Template in db.js and llm_crawler.js
  console.log('\n[2. Testing Canonical LLM Prompt Template Rankings]');
  assert(db.DEFAULT_LLM_PROMPT_TEMPLATE.includes('national_rank_england'), 'db prompt template must contain national_rank_england');
  assert(db.DEFAULT_LLM_PROMPT_TEMPLATE.includes('gcse_rank_england'), 'db prompt template must contain gcse_rank_england');
  assert(db.DEFAULT_LLM_PROMPT_TEMPLATE.includes('a_level_rank_england'), 'db prompt template must contain a_level_rank_england');
  assert(llmCrawler.DEFAULT_LLM_PROMPT_TEMPLATE.includes('national_rank_england'), 'llmCrawler prompt template must contain national_rank_england');
  assert(llmCrawler.DEFAULT_LLM_PROMPT_TEMPLATE.includes('gcse_rank_england'), 'llmCrawler prompt template must contain gcse_rank_england');
  assert(llmCrawler.DEFAULT_LLM_PROMPT_TEMPLATE.includes('a_level_rank_england'), 'llmCrawler prompt template must contain a_level_rank_england');
  console.log('  ✓ Verified ranking instructions and JSON schema fields in prompt templates.');

  // 3. Testing db.insertSchool & recordToSchool with Explicit Integer Rankings
  console.log('\n[3. Testing db.insertSchool with Explicit Integer Rankings]');
  const testSchoolWithRank = {
    id: 'test-rank-school-1',
    name: 'Top Tier Grammar School',
    la: 'Barnet',
    region: 'Greater London',
    schoolType: 'Grammar',
    national_rank_england: 12,
    gcse_rank_england: 8,
    a_level_rank_england: 15
  };

  db.insertSchool(testSchoolWithRank);
  const fetchedRanked = db.getSchoolById('test-rank-school-1');
  assert.strictEqual(fetchedRanked.national_rank_england, 12, 'National rank must be 12');
  assert.strictEqual(fetchedRanked.gcse_rank_england, 8, 'GCSE rank must be 8');
  assert.strictEqual(fetchedRanked.a_level_rank_england, 15, 'A-Level rank must be 15');
  console.log('  ✓ Stored and retrieved integer ranks: National #12, GCSE #8, A-Level #15.');

  // 4. Testing db.insertSchool with Null/Unavailable Rankings
  console.log('\n[4. Testing db.insertSchool with Null/Unavailable Rankings]');
  const testSchoolNoRank = {
    id: 'test-rank-school-2',
    name: 'Community High School',
    la: 'Camden',
    region: 'Greater London',
    schoolType: 'Comprehensive',
    national_rank_england: null,
    gcse_rank_england: null,
    a_level_rank_england: null
  };

  db.insertSchool(testSchoolNoRank);
  const fetchedUnranked = db.getSchoolById('test-rank-school-2');
  assert.strictEqual(fetchedUnranked.national_rank_england, null, 'National rank must be null');
  assert.strictEqual(fetchedUnranked.gcse_rank_england, null, 'GCSE rank must be null');
  assert.strictEqual(fetchedUnranked.a_level_rank_england, null, 'A-Level rank must be null');
  console.log('  ✓ Confirmed: When ranks are unavailable, fields store and return null.');

  // 5. Testing llmCrawler.applyLLMResultToSchool with Extracted Rankings
  console.log('\n[5. Testing llmCrawler.applyLLMResultToSchool with Rankings]');
  const llmPayloadWithRanks = {
    name: 'Top Tier Grammar School',
    schoolType: 'Grammar',
    gender: 'Mixed',
    admissionsOverview: '• Highly selective 11+ entrance testing with top ranking league standing.',
    entranceExamType: 'GL Assessment (English & Maths)',
    national_rank_england: 5,
    gcse_rank_england: 3,
    a_level_rank_england: 7,
    confidenceScore: 98
  };

  await llmCrawler.applyLLMResultToSchool('test-rank-school-1', {
    success: true,
    data: llmPayloadWithRanks,
    provider: 'gemini',
    model: 'gemini-3.6-flash'
  });
  const updatedSchoolWithRanks = db.getSchoolById('test-rank-school-1');
  assert.strictEqual(updatedSchoolWithRanks.national_rank_england, 5, 'National rank should be updated to 5');
  assert.strictEqual(updatedSchoolWithRanks.gcse_rank_england, 3, 'GCSE rank should be updated to 3');
  assert.strictEqual(updatedSchoolWithRanks.a_level_rank_england, 7, 'A-Level rank should be updated to 7');
  console.log('  ✓ applyLLMResultToSchool successfully updated school with rankings: National #5, GCSE #3, A-Level #7.');

  // 6. Testing llmCrawler.applyLLMResultToSchool when Rankings are null
  console.log('\n[6. Testing llmCrawler.applyLLMResultToSchool with Null Rankings]');
  const llmPayloadNullRanks = {
    name: 'Community High School',
    schoolType: 'Comprehensive',
    gender: 'Mixed',
    admissionsOverview: '• Standard local authority admissions policy.',
    national_rank_england: null,
    gcse_rank_england: null,
    a_level_rank_england: null,
    confidenceScore: 90
  };

  await llmCrawler.applyLLMResultToSchool('test-rank-school-2', {
    success: true,
    data: llmPayloadNullRanks,
    provider: 'gemini',
    model: 'gemini-3.6-flash'
  });
  const updatedSchoolNullRanks = db.getSchoolById('test-rank-school-2');
  assert.strictEqual(updatedSchoolNullRanks.national_rank_england, null, 'National rank must remain null');
  assert.strictEqual(updatedSchoolNullRanks.gcse_rank_england, null, 'GCSE rank must remain null');
  assert.strictEqual(updatedSchoolNullRanks.a_level_rank_england, null, 'A-Level rank must remain null');
  console.log('  ✓ applyLLMResultToSchool successfully stored null for unranked school.');

  // Cleanup test records
  db.deleteSchool('test-rank-school-1');
  db.deleteSchool('test-rank-school-2');

  console.log('\n======================================================');
  console.log('🎉 ALL SCHOOL RANKINGS & LLM PROMPT TESTS PASSED!');
  console.log('======================================================\n');
}

runTests().catch(err => {
  console.error('Test failure:', err);
  process.exit(1);
});
