const assert = require('assert');
const db = require('../db');
const llmCrawler = require('../scripts/llm_crawler');

async function runTests() {
  console.log('=== Testing Search-Based LLM Query & Browser Search Fidelity Suite ===');

  // 1. Template Verification
  console.log('\n[1. Verifying Search-Based Directives in Prompt Template]');
  const template = db.DEFAULT_LLM_PROMPT_TEMPLATE;
  assert(template.includes('SEARCH-BASED ANSWERS'), 'Must instruct model to use search-based answers');
  assert(template.includes('BROWSER SEARCH FIDELITY'), 'Must instruct model with browser search fidelity');
  assert(template.includes('{{search_queries}}'), 'Template must include {{search_queries}} placeholder');
  assert(template.includes('{{website_domain}}') || template.includes('{{search_queries}}'), 'Template must support search placeholders');
  assert(template.includes('2026') && template.includes('2027'), 'Must specify 2026-2027 admissions cycle');
  assert(template.includes('ZERO GUESSWORK'), 'Must mandate zero guesswork on unverified dates');
  console.log('  ✓ Search-based directives and placeholders present in master template.');

  // 2. Prompt Rendering Verification with Search Queries Generation
  console.log('\n[2. Verifying Search Queries Formulation in renderPrompt]');
  const sampleSchool = {
    id: 'sch-dulwich-test',
    name: 'Dulwich College',
    website: 'https://www.dulwich.org.uk',
    postcode: 'SE21 7LD',
    city: 'London',
    county: 'Greater London',
    region: 'London',
    urn: '100863',
    schoolType: 'Independent'
  };

  const rendered = llmCrawler.renderPrompt(template, sampleSchool);
  assert(rendered.includes('Dulwich College'), 'Rendered prompt must contain school name');
  assert(rendered.includes('SE21 7LD'), 'Rendered prompt must contain postcode');
  assert(rendered.includes('dulwich.org.uk'), 'Rendered prompt must extract and contain website domain');
  assert(rendered.includes('Search Query 1: "Dulwich College"'), 'Rendered prompt must generate pre-formulated Search Query 1');
  assert(rendered.includes('site:dulwich.org.uk'), 'Rendered prompt must generate site-specific search query');
  assert(rendered.includes('DfE GIAS URN 100863'), 'Rendered prompt must generate GIAS register search query');
  console.log('  ✓ renderPrompt generates targeted Google search queries and domain parameters.');

  // 3. Google Search URL Construction
  console.log('\n[3. Verifying Direct Google Search URL Helper]');
  const googleUrl = llmCrawler.getGoogleSearchUrl(sampleSchool);
  assert(googleUrl.startsWith('https://www.google.com/search?q='), 'Must point to Google Search endpoint');
  assert(googleUrl.includes('Dulwich'), 'Query must include school name');
  assert(googleUrl.includes('SE21%207LD') || googleUrl.includes('SE21+7LD'), 'Query must include postcode');
  assert(googleUrl.includes('11%2B') || googleUrl.includes('11+'), 'Query must target 11+ admissions');
  console.log('  ✓ getGoogleSearchUrl produces direct browser search link:', googleUrl);

  // 4. Gemini Crawler Search Grounding Tool & Graceful Fallback
  console.log('\n[4. Verifying Gemini Search Grounding Integration]');
  let mockToolCalls = 0;
  let mockFallbackCalls = 0;

  const mockFetchWithGrounding = async (url, headers, body) => {
    mockToolCalls++;
    return {
      ok: true,
      status: 200,
      json: {
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                name: 'Dulwich College',
                website: 'https://www.dulwich.org.uk',
                schoolType: 'Independent',
                gender: 'Boys',
                entranceExamType: 'Dulwich College 11+ Entrance Exam',
                entranceExamDates: {
                  registrationOpen: '1 September 2025',
                  registrationDeadline: '31 October 2025',
                  stage_one_examDate: '10 January 2026',
                  interviewDates: '26 January 2026',
                  offerDate: '12 February 2026',
                  acceptanceDeadline: '5 March 2026'
                },
                feesTermly: '£8,500',
                confidenceScore: 98
              })
            }]
          },
          groundingMetadata: {
            webSearchQueries: ['Dulwich College admissions 11+ key dates 2026'],
            groundingChunks: [
              { web: { uri: 'https://www.dulwich.org.uk/admissions/year-7-entry', title: 'Year 7 Entry | Dulwich College' } }
            ]
          }
        }]
      },
      bodyText: ''
    };
  };

  const groundedTest = await llmCrawler.crawlSchoolWithGemini(sampleSchool, {
    apiKey: 'test-gemini-key',
    fetchFn: mockFetchWithGrounding
  });

  assert(groundedTest.success === true, 'Crawl must succeed with search grounding');
  assert(groundedTest.exactRequest.payload.tools, 'Payload must include tools for search grounding');
  assert.deepStrictEqual(groundedTest.exactRequest.payload.tools[0], { googleSearch: {} }, 'Tools must specify googleSearch');
  assert.strictEqual(groundedTest.data.sourceUrl, 'https://www.dulwich.org.uk/admissions/year-7-entry', 'Must auto-populate sourceUrl from grounding chunks');
  assert.strictEqual(groundedTest.searchQueries[0], 'Dulwich College admissions 11+ key dates 2026', 'Must capture search queries in result');
  assert(groundedTest.googleSearchUrl.includes('Dulwich'), 'Result must include direct Google Search URL');
  console.log('  ✓ Gemini crawler successfully sends search tools and captures grounding metadata.');

  // 5. Verifying Graceful Fallback if Tools are Rejected by API
  console.log('\n[5. Verifying Graceful Fallback when Tools are Rejected (HTTP 400)]');
  let rejectedOnce = false;

  const mockFetchRejectTools = async (url, headers, body) => {
    if (body.tools && !rejectedOnce) {
      rejectedOnce = true;
      return {
        ok: false,
        status: 400,
        bodyText: 'INVALID_ARGUMENT: tools are not supported with responseMimeType application/json',
        json: null
      };
    }
    // Fallback call without tools
    mockFallbackCalls++;
    return {
      ok: true,
      status: 200,
      json: {
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                name: 'Dulwich College',
                website: 'https://www.dulwich.org.uk',
                gender: 'Boys',
                entranceExamType: 'Dulwich 11+',
                sourceUrl: 'https://www.dulwich.org.uk/admissions',
                confidenceScore: 95
              })
            }]
          }
        }]
      },
      bodyText: ''
    };
  };

  const fallbackTest = await llmCrawler.crawlSchoolWithGemini(sampleSchool, {
    apiKey: 'test-gemini-key',
    fetchFn: mockFetchRejectTools
  });

  assert(fallbackTest.success === true, 'Crawl must recover and succeed on fallback');
  assert(rejectedOnce === true, 'First attempt with tools was rejected as expected');
  assert(mockFallbackCalls === 1, 'Fallback call executed smoothly without tools');
  console.log('  ✓ Gemini crawler gracefully recovers without tools if API rejects tool arguments.');

  // 6. ChatGPT Crawler Search Prompting
  console.log('\n[6. Verifying ChatGPT Search-Based Directives & Search URLs]');
  const mockChatGptFetch = async (url, headers, body) => {
    assert(body.messages[0].content.includes('search-based answers'), 'System prompt must instruct search-based answers');
    return {
      ok: true,
      status: 200,
      json: {
        choices: [{
          message: {
            content: JSON.stringify({
              name: 'Dulwich College',
              schoolType: 'Independent',
              gender: 'Boys',
              sourceUrl: 'https://www.dulwich.org.uk',
              confidenceScore: 95
            })
          }
        }]
      },
      bodyText: ''
    };
  };

  const gptTest = await llmCrawler.crawlSchoolWithChatGPT(sampleSchool, {
    apiKey: 'sk-test-proj-key',
    fetchFn: mockChatGptFetch
  });

  assert(gptTest.success === true, 'ChatGPT crawl must succeed');
  assert(gptTest.googleSearchUrl.includes('Dulwich'), 'ChatGPT result must include googleSearchUrl');
  console.log('  ✓ ChatGPT system prompt specifies search-based answers and returns googleSearchUrl.');

  console.log('\n==================================================================');
  console.log('🎉 ALL SEARCH-BASED LLM QUERY & RETRIEVAL TESTS PASSED WITH 100% SUCCESS!');
  console.log('==================================================================');
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
