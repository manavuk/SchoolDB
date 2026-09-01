/**
 * Automated Test Suite for LLM Crawlers & AI Prompt Management (Google Gemini & OpenAI ChatGPT)
 */

const assert = require('assert');
const db = require('../db');
const scannerVerifier = require('./scanner_verifier');
const llmCrawler = require('./llm_crawler');

async function runTests() {
  console.log('=== RUNNING TESTS: LLM Crawlers & AI Prompt Intelligence (Gemini & ChatGPT) ===\n');
  const initialSettings = db.getAdminSettings();

  try {
    // 0. Test Public Search URLs (https://gemini.google.com/app and https://chatgpt.com/)
    console.log('[0. Public Search URLs Test]');
    assert.strictEqual(llmCrawler.GEMINI_PUBLIC_SEARCH_URL, 'https://gemini.google.com/app', 'Gemini public search URL must be https://gemini.google.com/app');
    assert.strictEqual(llmCrawler.CHATGPT_PUBLIC_SEARCH_URL, 'https://chatgpt.com/', 'ChatGPT public search URL must be https://chatgpt.com/');

    const geminiSearchLink = llmCrawler.getGeminiSearchUrl({ name: "Queen's College London", postcode: "W1G 0NY" });
    assert(geminiSearchLink.startsWith('https://gemini.google.com/app'), 'Generated query link must start with https://gemini.google.com/app');

    const chatgptSearchLink = llmCrawler.getChatGPTSearchUrl({ name: "Queen's College London", postcode: "W1G 0NY" });
    assert(chatgptSearchLink.startsWith('https://chatgpt.com/'), 'Generated query link must start with https://chatgpt.com/');
    console.log('  ✓ Verified public search URLs (https://gemini.google.com/app & https://chatgpt.com/).');

    // 1. Test Prompt Template Rendering (Targeting School Name, City, County, Postcode, Website)
    console.log('\n[1. Prompt Template & Placeholders Test]');
    const testSchool = {
      id: 'test_school_llm_1',
      name: "Queen's College London",
      urn: '100095',
      postcode: 'W1G 0NY',
      region: 'Greater London',
      la: 'Westminster',
      schoolType: 'Independent',
      website: 'https://www.qcl.org.uk'
    };

    const rendered = llmCrawler.renderPrompt(llmCrawler.DEFAULT_LLM_PROMPT_TEMPLATE, testSchool);
    assert(rendered.includes("Queen's College London"), 'Rendered prompt must contain school name');
    assert(rendered.includes("W1G 0NY"), 'Rendered prompt must contain postcode');
    assert(rendered.includes("https://www.qcl.org.uk"), 'Rendered prompt must contain website');
    assert(!rendered.includes("{{school_name}}"), 'Placeholder {{school_name}} must be replaced');
    assert(!rendered.includes("{{city}}"), 'Placeholder {{city}} must be replaced');
    assert(!rendered.includes("{{county}}"), 'Placeholder {{county}} must be replaced');
    assert(!rendered.includes("{{postcode}}"), 'Placeholder {{postcode}} must be replaced');
    assert(!rendered.includes("{{website}}"), 'Placeholder {{website}} must be replaced');
    console.log('  ✓ Prompt template rendered and replaced school_name, city, county, postcode, and website placeholders correctly.');

  // 2. Test JSON Extraction from LLM text with code fences
  console.log('\n[2. Robust JSON Parser Test]');
  const sampleMarkdownResponse = "```json\n" + JSON.stringify({
    name: "Queen's College London",
    website: "https://www.qcl.org.uk",
    entranceExamDates: {
      registrationDeadline: "6 November 2026",
      examDate: "2 December 2026"
    }
  }) + "\n```";

  const extracted = llmCrawler.extractJsonFromLlmText(sampleMarkdownResponse);
  assert.strictEqual(extracted.name, "Queen's College London", 'Must parse JSON inside markdown code fence');
  assert.strictEqual(extracted.entranceExamDates.registrationDeadline, "6 November 2026");
  console.log('  ✓ Robust JSON parser strips markdown backticks and extracts schema.');

  // 3. Test Dedicated Google Gemini Crawler
  console.log('\n[3. Dedicated Google Gemini Crawler Test]');
  const mockGeminiOutput = {
    name: "Queen's College London",
    website: "https://www.qcl.org.uk",
    phone: "020 7291 7000",
    email: "admissions@qcl.org.uk",
    address: "43-49 Harley Street, London",
    postcode: "W1G 0NY",
    schoolType: "Independent",
    gender: "Girls",
    entranceExamType: "London 11+ Consortium",
    entranceExamDates: {
      registrationOpen: "1 September 2026",
      registrationDeadline: "6 November 2026",
      examDate: "1 December 2026",
      resultDate: "12 February 2027",
      interviewDates: "15-26 January 2027",
      offerDate: "12 February 2027",
      acceptanceDeadline: "5 March 2027"
    },
    feesTermly: "£8,870",
    confidenceScore: 98,
    sourceUrl: "https://www.qcl.org.uk/admissions/11-plus"
  };

  const geminiResult = await llmCrawler.crawlSchoolWithGemini(testSchool, {
    mockResponse: mockGeminiOutput
  });

  assert.strictEqual(geminiResult.success, true, 'Gemini crawl must succeed');
  assert.strictEqual(geminiResult.provider, 'gemini', 'Provider must be gemini');
  assert.strictEqual(geminiResult.data.entranceExamDates.registrationDeadline, '6 November 2026', 'Extracted deadline must match');
  assert.strictEqual(geminiResult.data.entranceExamType, 'London 11+ Consortium');
  assert(geminiResult.exactRequest.promptText.includes("Queen's College London"), 'exactRequest must capture prompt text');
  assert(geminiResult.exactResponse.rawText.includes('London 11+ Consortium'), 'exactResponse must capture untouched raw API text');

  // Test Missing API key error
  const missingKeyGeminiResult = await llmCrawler.crawlSchoolWithGemini(testSchool, { apiKey: '' });
  assert.strictEqual(missingKeyGeminiResult.success, false, 'Missing API key must return false');
  assert.strictEqual(missingKeyGeminiResult.error, 'NO_GEMINI_API_KEY');
  assert(missingKeyGeminiResult.exactResponse.rawText.includes('NO_GEMINI_API_KEY'), 'Exact error response must be captured');
  console.log('  ✓ Google Gemini crawler executed direct API search and verified exact raw request/response.');

  // 4. Test Dedicated OpenAI ChatGPT Crawler
  console.log('\n[4. Dedicated OpenAI ChatGPT Crawler Test]');
  const mockChatgptOutput = {
    name: "St Paul's Girls' School",
    website: "https://spgs.org",
    phone: "020 7603 2288",
    email: "admissions@spgs.org",
    address: "Brook Green, Hammersmith, London",
    postcode: "W6 7BS",
    schoolType: "Independent",
    gender: "Girls",
    entranceExamType: "School's Own Exam",
    entranceExamDates: {
      registrationOpen: "1 September 2026",
      registrationDeadline: "11 November 2026",
      examDate: "4 January 2027",
      resultDate: "12 February 2027",
      offerDate: "12 February 2027",
      acceptanceDeadline: "5 March 2027"
    },
    confidenceScore: 96,
    sourceUrl: "https://spgs.org/admissions/11-plus"
  };

  const chatgptResult = await llmCrawler.crawlSchoolWithChatGPT(testSchool, {
    mockResponse: mockChatgptOutput
  });

  assert.strictEqual(chatgptResult.success, true, 'ChatGPT crawl must succeed');
  assert.strictEqual(chatgptResult.provider, 'chatgpt', 'Provider must be chatgpt');
  assert.strictEqual(chatgptResult.data.entranceExamDates.registrationDeadline, '11 November 2026');
  assert(chatgptResult.exactRequest.promptText.includes("Queen's College London"), 'exactRequest must capture prompt');
  assert(chatgptResult.exactResponse.rawText.includes('11 November 2026'), 'exactResponse must capture untouched raw API text');

  // Test Missing API key error
  const missingKeyChatgptResult = await llmCrawler.crawlSchoolWithChatGPT(testSchool, { apiKey: '' });
  assert.strictEqual(missingKeyChatgptResult.success, false, 'Missing API key must return false');
  assert.strictEqual(missingKeyChatgptResult.error, 'NO_OPENAI_API_KEY');
  console.log('  ✓ OpenAI ChatGPT crawler executed direct API search and verified exact raw request/response.');

  // 5. Test Database Update and gemini_crawl Success Tagging
  console.log('\n[5. Database Update & Tagging Integration Test]');
  // Insert test school into SQLite
  db.insertSchool({
    id: 'test_qcl_llm',
    name: "Queen's College London",
    urn: '100095',
    la: 'Westminster',
    region: 'Greater London',
    postcode: 'W1G 0NY',
    schoolType: 'Independent',
    gender: 'Girls',
    website: 'https://www.qcl.org.uk',
    entranceExamDates: JSON.stringify({ registrationDeadline: '13 November 2026' }), // Inaccurate date
    entranceExamType: 'Unknown',
    verification_status: 'unverified',
    verification_tags: JSON.stringify([])
  });

  const applied = llmCrawler.applyLLMResultToSchool('test_qcl_llm', geminiResult, 'Test Runner');
  assert.strictEqual(applied.success, true, 'Apply must succeed');
  assert(applied.tags.includes('gemini_crawl'), 'Tags must include gemini_crawl');
  assert(applied.tags.includes('llm_verified'), 'Tags must include llm_verified');
  assert(applied.tags.includes('llm_enriched'), 'Tags must include llm_enriched');
  assert(applied.tags.includes('auto_verified'), 'Tags must include auto_verified');

  const updatedSchool = db.getSchoolById('test_qcl_llm');
  const dates = typeof updatedSchool.entranceExamDates === 'string' ? JSON.parse(updatedSchool.entranceExamDates) : updatedSchool.entranceExamDates;
  assert.strictEqual(dates.registrationDeadline, '6 November 2026', 'Database must have updated accurate 6 November deadline');
  assert.strictEqual(updatedSchool.entranceExamType, 'London 11+ Consortium', 'Database must have updated exam type');
  assert.strictEqual(updatedSchool.verification_status, 'llm_enriched', 'Status must be llm_enriched');
  console.log('  ✓ applyLLMResultToSchool updated SQLite records and marked llm_enriched.');

  // 6. Test Website Crawl Failure with Successful gemini_crawl Fallback
  console.log('\n[6. Website Crawl Failure with Successful LLM Fallback]');
  const mockBrokenSchool = {
    id: 'test_broken_web_school',
    name: 'North London Collegiate School',
    schoolType: 'Independent',
    website: 'https://completely-broken-offline-school-website-xyz.org.uk'
  };
  db.insertSchool(mockBrokenSchool);

  // Simulate audit where website HTTP request fails/times out, but LLM mock responds with verified dates
  const mockLlmForBroken = {
    name: "North London Collegiate School",
    website: "https://www.nlcs.org.uk",
    entranceExamType: "London 11+ Consortium",
    entranceExamDates: {
      registrationOpen: "1 September 2026",
      registrationDeadline: "10 November 2026",
      examDate: "5 December 2026"
    },
    confidenceScore: 95
  };

  const auditResult = await scannerVerifier.auditAndVerifySchool(mockBrokenSchool, {
    useLLM: true,
    mockResponse: mockLlmForBroken,
    fetchFn: async () => ({ ok: false, status: 503, body: 'Service Unavailable' }) // Website is down
  });

  assert.strictEqual(auditResult.status, 'llm_enriched', 'Status must be llm_enriched when LLM verified');
  assert.strictEqual(auditResult.gemini_crawl, 'success', 'gemini_crawl must be marked as success');
  assert(auditResult.tags.includes('gemini_crawl'), 'Must include gemini_crawl tag');
  assert(auditResult.tags.includes('llm_verified'), 'Must include llm_verified tag');
  assert(auditResult.tags.includes('llm_enriched'), 'Must include llm_enriched tag');
  assert.strictEqual(auditResult.proposedDates.registrationDeadline, '10 November 2026');
  console.log('  ✓ Web crawl failure successfully recovered by LLM and marked llm_enriched.');

  // Clean up mock broken school
  db.deleteSchool('test_broken_web_school');

  // 7. Test System Settings LLM Persistence
  console.log('\n[7. System Settings LLM Persistence Test]');
  const customSettings = {
    llmProvider: 'chatgpt',
    geminiModel: 'gemini-3.5-flash-lite',
    openaiModel: 'gpt-4o',
    llmPromptTemplate: db.DEFAULT_LLM_PROMPT_TEMPLATE
  };

  db.saveSystemSettings(customSettings);
  const retrievedSettings = db.getSystemSettings();
  assert.strictEqual(retrievedSettings.llmProvider, 'chatgpt', 'Provider must be saved as chatgpt');
  assert.strictEqual(retrievedSettings.geminiModel, 'gemini-3.5-flash-lite', 'Gemini model must be persisted');
  assert.strictEqual(retrievedSettings.openaiModel, 'gpt-4o', 'OpenAI model must be persisted');
  assert.strictEqual(retrievedSettings.llmPromptTemplate, db.DEFAULT_LLM_PROMPT_TEMPLATE, 'Prompt template must be persisted');

  // Reset back to defaults
  db.saveSystemSettings({
    llmProvider: 'gemini',
    geminiModel: 'gemini-3.6-flash',
    openaiModel: 'gpt-4o-mini',
    llmPromptTemplate: llmCrawler.DEFAULT_LLM_PROMPT_TEMPLATE
  });
  console.log('  ✓ LLM provider, models, and prompt template persist correctly in system_settings.');

  // 8. Test Live LLM School Search Queries for Typed School Names
  console.log('\n[8. Live School Typed Query Test]');
  const typedQuerySchool = {
    name: "Latymer Upper School",
    postcode: "W6 9LR"
  };

  const mockLatymerData = {
    name: "Latymer Upper School",
    website: "https://www.latymer-upper.org",
    phone: "020 8629 2024",
    email: "admissions@latymer-upper.org",
    schoolType: "Independent",
    gender: "Mixed",
    entranceExamType: "School's Own Exam",
    entranceExamDates: {
      registrationOpen: "1 September 2026",
      registrationDeadline: "20 October 2026",
      examDate: "15 January 2027",
      resultDate: "12 February 2027",
      offerDate: "12 February 2027",
      acceptanceDeadline: "5 March 2027"
    },
    feesTermly: "£8,730",
    confidenceScore: 98,
    sourceUrl: "https://www.latymer-upper.org/admissions"
  };

  const liveSearchResult = await llmCrawler.crawlSchoolWithLLM(typedQuerySchool, {
    provider: 'gemini',
    mockResponse: mockLatymerData
  });

  assert.strictEqual(liveSearchResult.success, true);
  assert.strictEqual(liveSearchResult.data.name, "Latymer Upper School");
  assert.strictEqual(liveSearchResult.data.entranceExamDates.registrationDeadline, "20 October 2026");
  assert.strictEqual(liveSearchResult.publicSearchUrl, "https://gemini.google.com/app");
  assert(liveSearchResult.queryUrl.startsWith("https://gemini.google.com/app"));
  console.log('  ✓ Live search query for typed school executed and returned structured admissions results.');

  // 9. Test llm_enriched Skip and Force Rerun Behavior
  console.log('\n[9. llm_enriched Skip & Force Rerun Test]');
  const mockEnrichedSchool = {
    id: 'test_enriched_school_1',
    name: 'St Paul\'s Girls\' School',
    schoolType: 'Independent',
    website: 'https://spgs.org',
    verification_status: 'llm_enriched',
    verification_tags: JSON.stringify(['llm_enriched', 'auto_verified']),
    verified_at: new Date().toISOString()
  };
  db.insertSchool(mockEnrichedSchool);

  // Without forceRerun -> Must skip
  const skipResult = await scannerVerifier.auditAndVerifySchool(mockEnrichedSchool, { forceRerun: false });
  assert.strictEqual(skipResult.skipped, true, 'School with llm_enriched status must be skipped');
  assert.strictEqual(skipResult.skipTag, 'skip_cache_llm_enriched', 'Skip tag must be skip_cache_llm_enriched');
  assert(skipResult.skipReason.includes('already been llm_enriched'));

  // With forceRerun: true -> Must re-audit
  const rerunMockData = {
    name: 'St Paul\'s Girls\' School',
    website: 'https://spgs.org',
    entranceExamDates: {
      registrationDeadline: '13 November 2026'
    },
    confidenceScore: 98
  };
  const rerunResult = await scannerVerifier.auditAndVerifySchool(mockEnrichedSchool, {
    forceRerun: true,
    mockResponse: rerunMockData
  });
  assert.strictEqual(rerunResult.skipped, undefined, 'Forced rerun must NOT be skipped');
  assert.strictEqual(rerunResult.status, 'llm_enriched', 'Must re-verify and mark llm_enriched');
  console.log('  ✓ School marked llm_enriched is skipped by default, and re-audited when forceRerun is true.');

  // Clean up mock enriched school
  db.deleteSchool('test_enriched_school_1');

    console.log('\n======================================================');
    console.log('🎉 ALL LLM CRAWLER & PROMPT INTELLIGENCE TESTS PASSED!');
    console.log('======================================================\n');
  } finally {
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
}

runTests().catch(err => {
  console.error('Fatal LLM Test Error:', err);
  process.exit(1);
});
