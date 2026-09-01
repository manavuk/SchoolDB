/**
 * Dedicated LLM Crawlers for School Admissions Intelligence (Google Gemini & OpenAI ChatGPT)
 * 
 * Provides:
 * 1. Direct API integration with Google Gemini (v1beta generateContent) with JSON mode.
 * 2. Direct API integration with OpenAI ChatGPT (v1 chat completions) with JSON object mode.
 * 3. Default and customizable prompt template for 11+ school admissions data extraction.
 * 4. Transparent logging capturing exact raw request sent and untouched raw response body received.
 * 5. School database updater & audit trail logger (applyLLMResultToSchool).
 */

const https = require('https');
const http = require('http');

let db = null;
try {
  db = require('../db');
} catch (e) {
  try {
    db = require('./db');
  } catch (e2) {}
}

// Public search reference URLs
const GEMINI_PUBLIC_SEARCH_URL = 'https://gemini.google.com/app';
const CHATGPT_PUBLIC_SEARCH_URL = 'https://chatgpt.com/';

function getGeminiSearchUrl(school, promptText = null) {
  const query = promptText || (school ? `Admissions 11+ entrance exam dates fees ${school.name} ${school.postcode || ''}` : '');
  return `${GEMINI_PUBLIC_SEARCH_URL}${query ? `?q=${encodeURIComponent(query)}` : ''}`;
}

function getChatGPTSearchUrl(school, promptText = null) {
  const query = promptText || (school ? `Admissions 11+ entrance exam dates fees ${school.name} ${school.postcode || ''}` : '');
  return `${CHATGPT_PUBLIC_SEARCH_URL}${query ? `?q=${encodeURIComponent(query)}` : ''}`;
}

function getLLMPublicSearchUrl(provider = 'gemini', school = null, promptText = null) {
  const prov = (provider || '').toLowerCase();
  if (prov === 'chatgpt' || prov === 'openai') {
    return getChatGPTSearchUrl(school, promptText);
  }
  return getGeminiSearchUrl(school, promptText);
}

const DEFAULT_LLM_PROMPT_TEMPLATE = `You are an expert UK School Admissions Data Researcher and Verifier. Your task is to provide accurate, verified, and structured information for the following UK school:

Target School Identification & Anchors:
- School Name: {{school_name}}
- City / Town: {{city}}
- Local Authority / County: {{county}}
- Postcode: {{postcode}}
- Known Website: {{website}}

CRITICAL ACCURACY & ANTI-HALLUCINATION RULES:
1. STRICT DISAMBIGUATION: You must verify information ONLY for the specific UK school located at Postcode {{postcode}} in {{city}}, {{county}}. Do NOT confuse with schools of similar or identical names in other regions.
2. ABSOLUTE ACCURACY OVER COMPLETENESS (ZERO GUESSWORK ON BASIC INFO): Never guess, estimate, or fabricate basic school details. If any field is unconfirmed, return null.
3. STRICT GENDER POLICY & BASIC PROFILE INTEGRITY:
   - 'gender': You MUST return "Girls", "Boys", or "Mixed" ONLY if 100% verified from official sources (such as DfE Get Information About Schools or official school website). NEVER default to "Mixed" or guess the gender policy. If single-sex girls, state "Girls"; if single-sex boys, state "Boys"; if co-educational, state "Mixed". If unconfirmed, set null.
   - 'schoolType' / 'rawSchoolType': Return accurate classification ("Independent", "Grammar", "Comprehensive", or official DfE category).
   - 'ageRange': Return official age range (e.g. "11 to 18", "4 to 11", "11 to 16", "3 to 19") if verified; otherwise set null.
   - 'address': Return full official postal street address if known (e.g. including road/street name). Do not replace a detailed address with just a city name. If unknown, set null.
   - 'description': Provide an accurate summary of the school and its ethos.
   - 'website', 'phone', 'email': Return official contact info if known; otherwise null.
4. 11+ ADMISSIONS CYCLE CONTEXT:
   - Focus on Year 7 entry (11+ admissions). Dates must follow "Day Month Year" format (e.g. "6 November 2026").
   - For Grammar / State Selective: Identify exact 11+ consortium/board (e.g. "GL Assessment", "CSSE 11+", "Kent 11+ PESE", "School's Own Exam"). Fees must be null.
   - For Independent / Fee-Paying: Identify exam format (e.g. "ISEB Common Pre-Test", "London 11+ Consortium", "School's Own Assessment"), termly tuition fee (e.g. "£7,500"), and registration fee (e.g. "£150").
   - For Comprehensive / Non-Selective State: Exam board is "Non-selective / DfE Coordinated Admissions", second_stage_exam_required is "No", fees are null.
   - If specific Year 7 entrance exam dates are not applicable or unconfirmed (e.g. primary/special/non-selective), leave those date fields as null or empty arrays [].
5. OFFICIAL ENGLAND RANKINGS:
   - 'national_rank_england', 'gcse_rank_england', 'a_level_rank_england': Official integer rank in England if published; otherwise null.

Output ONLY a valid JSON object matching this schema with no markdown formatting, code blocks, or preamble:

{
  "name": "{{school_name}}",
  "website": null,
  "phone": null,
  "email": null,
  "address": null,
  "postcode": "{{postcode}}",
  "schoolType": null,
  "rawSchoolType": null,
  "gender": null,
  "ageRange": null,
  "description": null,
  "admissionsOverview": "",
  "entranceExamType": null,
  "entranceExamDates": {
    "registrationOpen": null,
    "registrationDeadline": null,
    "registrationFee": null,
    "stage_one_examDate": [],
    "stage_one_format_and_subjects": null,
    "stage_one_resultDate": null,
    "second_stage_exam_required": null,
    "stage_two_examDate": [],
    "stage_two_format_and_subjects": null,
    "stage_two_resultDate": null,
    "interviewDates": [],
    "offerDate": null,
    "acceptanceDeadline": null,
    "openEvents": null,
    "scholarshipsOffered": null,
    "bursaryDeadline": null
  },
  "feesTermly": null,
  "registrationFee": null,
  "national_rank_england": null,
  "gcse_rank_england": null,
  "a_level_rank_england": null,
  "confidenceScore": 95,
  "sourceUrl": null
}`;

/**
 * Extract school city and county (if available)
 */
function extractSchoolCityAndCounty(school) {
  const s = school || {};
  let city = s.city || s.town || '';
  let county = s.county || '';

  const region = s.region || '';
  const la = s.la || '';
  const address = s.address || '';

  // Common UK Counties list for matching
  const UK_COUNTIES = [
    'Bedfordshire', 'Berkshire', 'Bristol', 'Buckinghamshire', 'Cambridgeshire', 'Cheshire',
    'Cornwall', 'Cumbria', 'Derbyshire', 'Devon', 'Dorset', 'Durham', 'East Riding of Yorkshire',
    'East Sussex', 'Essex', 'Gloucestershire', 'Greater London', 'Greater Manchester', 'Hampshire',
    'Herefordshire', 'Hertfordshire', 'Isle of Wight', 'Kent', 'Lancashire', 'Leicestershire',
    'Lincolnshire', 'Merseyside', 'Norfolk', 'North Somerset', 'North Yorkshire', 'Northamptonshire',
    'Northumberland', 'Nottinghamshire', 'Oxfordshire', 'Rutland', 'Shropshire', 'Somerset',
    'South Gloucestershire', 'South Yorkshire', 'Staffordshire', 'Suffolk', 'Surrey', 'Tyne and Wear',
    'Warwickshire', 'West Midlands', 'West Sussex', 'West Yorkshire', 'Wiltshire', 'Worcestershire'
  ];

  // 1. County resolution
  if (!county) {
    if (UK_COUNTIES.includes(region)) {
      county = region;
    } else if (UK_COUNTIES.includes(la)) {
      county = la;
    } else if (region.toLowerCase().includes('london') || la.toLowerCase().includes('london')) {
      county = 'Greater London';
    } else if (region) {
      county = region;
    } else if (la) {
      county = la;
    }
  }

  // 2. City resolution
  if (!city) {
    if (region.toLowerCase().includes('london') || la.toLowerCase().includes('london') || (s.postcode && /^(E|EC|N|NW|SE|SW|W|WC)\d/i.test(s.postcode))) {
      city = 'London';
    } else if (la && !UK_COUNTIES.includes(la)) {
      city = la;
    } else if (address) {
      const parts = address.split(',').map(p => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        const candidate = parts[parts.length - 1].replace(/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i, '').trim();
        if (candidate && !UK_COUNTIES.includes(candidate)) {
          city = candidate;
        } else if (parts.length >= 3) {
          const candidate2 = parts[parts.length - 2].trim();
          if (candidate2 && !UK_COUNTIES.includes(candidate2)) {
            city = candidate2;
          }
        }
      }
    }
  }

  return {
    city: city || 'Not specified',
    county: county || 'Not specified'
  };
}

/**
 * Render prompt template with school specific placeholders
 */
function renderPrompt(template, school) {
  if (!template || typeof template !== 'string' || !template.includes('You are an expert UK School Admissions Data Researcher and Verifier')) {
    template = DEFAULT_LLM_PROMPT_TEMPLATE;
  }
  const s = school || {};
  const { city, county } = extractSchoolCityAndCounty(s);
  const region = s.region || s.la || county || city || 'Greater London / UK';
  const website = (s.website && s.website !== 'N/A' && s.website !== 'null' && s.website !== 'Unknown') ? s.website : 'Not available';

  return template
    .replace(/\{\{school_name\}\}/gi, s.name || '')
    .replace(/\{\{city\}\}/gi, city)
    .replace(/\{\{county\}\}/gi, county)
    .replace(/\{\{region\}\}/gi, region)
    .replace(/\{\{website\}\}/gi, website)
    .replace(/\{\{urn\}\}/gi, s.urn && s.urn !== 'N/A' ? s.urn : 'N/A')
    .replace(/\{\{postcode\}\}/gi, s.postcode || '')
    .replace(/\{\{school_type\}\}/gi, s.schoolType || 'Independent')
    .replace(/\{\{address\}\}/gi, s.address || '');
}

/**
 * Helper to make HTTP/HTTPS JSON POST requests
 */
async function makeJsonPost(urlString, headers = {}, bodyObj = {}, timeoutMs = 15000, customFetchFn = null) {
  if (customFetchFn && typeof customFetchFn === 'function') {
    return customFetchFn(urlString, headers, bodyObj);
  }

  if (typeof fetch === 'function') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(urlString, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers
        },
        body: JSON.stringify(bodyObj),
        signal: controller.signal
      });
      clearTimeout(timer);
      const text = await response.text();
      let json = null;
      try { json = JSON.parse(text); } catch (e) {}
      return {
        ok: response.ok,
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        bodyText: text,
        json
      };
    } catch (err) {
      clearTimeout(timer);
      const errMsg = err.name === 'AbortError' ? 'REQUEST_TIMEOUT: External LLM request timed out after 15000ms' : `FETCH_ERROR: ${err.message}`;
      return {
        ok: false,
        status: 0,
        headers: {},
        error: errMsg,
        bodyText: JSON.stringify({
          error: {
            code: err.name === 'AbortError' ? 'REQUEST_TIMEOUT' : 'FETCH_ERROR',
            message: errMsg
          },
          timestamp: new Date().toISOString()
        }, null, 2),
        json: { error: { message: errMsg, code: 'FETCH_ERROR' } }
      };
    }
  }

  return new Promise((resolve) => {
    try {
      const url = new URL(urlString);
      const isHttps = url.protocol === 'https:';
      const client = isHttps ? https : http;
      const postData = JSON.stringify(bodyObj);
      const req = client.request({
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          ...headers
        },
        timeout: timeoutMs
      }, (res) => {
        let raw = '';
        res.on('data', chunk => { raw += chunk; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(raw); } catch (e) {}
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            headers: res.headers,
            bodyText: raw || JSON.stringify(json || { status: res.statusCode }, null, 2),
            json
          });
        });
      });

      req.on('error', err => {
        const errMsg = `NETWORK_ERROR: ${err.message}`;
        resolve({
          ok: false,
          status: 0,
          headers: {},
          error: errMsg,
          bodyText: JSON.stringify({ error: { message: errMsg, code: 'NETWORK_ERROR' }, timestamp: new Date().toISOString() }, null, 2),
          json: { error: { message: errMsg } }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        const errMsg = 'REQUEST_TIMEOUT: Node HTTP socket timed out';
        resolve({
          ok: false,
          status: 0,
          headers: {},
          error: errMsg,
          bodyText: JSON.stringify({ error: { message: errMsg, code: 'TIMEOUT' }, timestamp: new Date().toISOString() }, null, 2),
          json: { error: { message: errMsg } }
        });
      });

      req.write(postData);
      req.end();
    } catch (e) {
      const errMsg = `EXECUTION_ERROR: ${e.message}`;
      resolve({
        ok: false,
        status: 0,
        headers: {},
        error: errMsg,
        bodyText: JSON.stringify({ error: { message: errMsg, code: 'EXECUTION_ERROR' }, timestamp: new Date().toISOString() }, null, 2),
        json: { error: { message: errMsg } }
      });
    }
  });
}

/**
 * Clean LLM response string to extract pure JSON with fault-tolerant auto-repair
 */
function extractJsonFromLlmText(text) {
  if (!text || typeof text !== 'string') return null;
  let clean = text.trim();

  // Try direct parse first
  try {
    return JSON.parse(clean);
  } catch (e) {}

  // 1. Remove markdown fences ```json ... ``` or extract innermost code block
  if (clean.includes('```')) {
    const codeMatch = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (codeMatch && codeMatch[1]) {
      clean = codeMatch[1].trim();
      try {
        return JSON.parse(clean);
      } catch (e) {}
    } else {
      clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    }
  }

  // 2. Extract outermost JSON boundaries { ... }
  const firstBrace = clean.indexOf('{');
  const lastBrace = clean.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    clean = clean.substring(firstBrace, lastBrace + 1);
  }

  try {
    return JSON.parse(clean);
  } catch (e) {}

  // 3. Repair Step: Strip JS comments
  let repaired = clean
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\r\n]*/g, '$1');

  // 4. Repair Step: Replace Python constants
  repaired = repaired
    .replace(/\bNone\b/g, 'null')
    .replace(/\bTrue\b/g, 'true')
    .replace(/\bFalse\b/g, 'false');

  // 5. Repair Step: Remove trailing commas before } or ]
  repaired = repaired.replace(/,(\s*[}\]])/g, '$1');

  // 6. Repair Step: Normalize single-quoted property keys
  repaired = repaired.replace(/([{,]\s*)'([^'\r\n]+)'\s*:/g, '$1"$2":');

  try {
    return JSON.parse(repaired);
  } catch (e) {}

  // 7. Repair Step: Fix unescaped control characters in string values
  repaired = repaired.replace(/[\u0000-\u0009\u000B-\u001F]+/g, ' ');

  try {
    return JSON.parse(repaired);
  } catch (e) {}

  return null;
}

/**
 * Direct Google Gemini API Crawler
 */
async function crawlSchoolWithGemini(school, options = {}) {
  const settings = db ? db.getSystemSettings() : {};
  const apiKey = options.apiKey !== undefined ? (options.apiKey ? options.apiKey.trim() : null) : (settings.geminiApiKey || process.env.GEMINI_API_KEY || null);
  const requestedModel = options.model || settings.geminiModel || 'gemini-3.6-flash';
  const promptTemplate = options.promptTemplate || settings.llmPromptTemplate || DEFAULT_LLM_PROMPT_TEMPLATE;
  const prompt = renderPrompt(promptTemplate, school);

  const exactRequestObj = {
    provider: 'gemini',
    model: requestedModel,
    endpoint: `https://generativelanguage.googleapis.com/v1beta/models/${requestedModel}:generateContent`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    promptText: prompt,
    schoolInput: {
      schoolName: school?.name || 'School',
      region: school?.region || school?.la || 'Greater London / UK',
      website: school?.website || 'Not available'
    },
    payload: {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.1 }
    },
    timestamp: new Date().toISOString()
  };

  // If mock response provided (for automated tests or offline validation)
  if (options.mockResponse) {
    const rawResponseText = typeof options.mockResponse === 'string' ? options.mockResponse : JSON.stringify(options.mockResponse, null, 2);
    const parsedData = typeof options.mockResponse === 'string' ? extractJsonFromLlmText(options.mockResponse) : options.mockResponse;
    return {
      success: true,
      provider: 'gemini',
      model: requestedModel,
      schoolId: school?.id,
      data: parsedData,
      exactRequest: exactRequestObj,
      exactResponse: {
        status: 200,
        statusText: '200 OK',
        rawText: rawResponseText,
        candidateText: rawResponseText,
        parsedJson: parsedData,
        timestamp: new Date().toISOString()
      },
      publicSearchUrl: GEMINI_PUBLIC_SEARCH_URL,
      queryUrl: getGeminiSearchUrl(school, prompt),
      crawledAt: new Date().toISOString()
    };
  }

  // Check API Key
  if (!apiKey) {
    const errText = JSON.stringify({
      error: 'NO_GEMINI_API_KEY',
      message: 'Google Gemini API key not configured in Admin Settings or GEMINI_API_KEY environment variable'
    }, null, 2);

    return {
      success: false,
      error: 'NO_GEMINI_API_KEY',
      message: 'Google Gemini API key not configured. Please enter your API key in Admin Settings > LLM Providers.',
      provider: 'gemini',
      model: requestedModel,
      schoolId: school?.id,
      exactRequest: exactRequestObj,
      exactResponse: {
        status: 400,
        statusText: '400 Bad Request (API Key Missing)',
        rawText: errText,
        parsedJson: null,
        timestamp: new Date().toISOString()
      }
    };
  }

  // Model alias mapping for Gemini models to ensure non-existent models gracefully map to valid endpoints
  const GEMINI_MODEL_ALIASES = {
    'gemini-3.6-flash-lite': 'gemini-3.5-flash-lite',
    'gemini-3.0-flash-lite': 'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite-preview': 'gemini-3.1-flash-lite',
    'gemini-3.0-flash': 'gemini-3.6-flash',
    'gemini-3-flash': 'gemini-3.6-flash',
    'gemini-3.6-pro': 'gemini-3.6-flash',
    'gemini-3.0-pro': 'gemini-3.6-flash'
  };

  let normalizedRequestedModel = requestedModel;
  if (GEMINI_MODEL_ALIASES[requestedModel]) {
    normalizedRequestedModel = GEMINI_MODEL_ALIASES[requestedModel];
  }

  // Candidate models to try in case of 404 NOT_FOUND on a specific model alias
  const candidateModels = [
    normalizedRequestedModel,
    'gemini-3.6-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
    'gemini-3.7-flash',
    'gemini-3.5-flash',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite'
  ].filter((v, i, a) => a.indexOf(v) === i);

  let res = null;
  let activeModel = requestedModel;

  for (const m of candidateModels) {
    activeModel = m;
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`;
    exactRequestObj.model = m;
    exactRequestObj.endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;

    res = await makeJsonPost(endpoint, {}, exactRequestObj.payload, options.timeoutMs || 15000, options.fetchFn);

    if (res.ok) {
      break;
    }

    // If rate-limited (HTTP 429 / RESOURCE_EXHAUSTED), wait 10 seconds and retry once
    if (res.status === 429 || (res.bodyText && (res.bodyText.includes('RESOURCE_EXHAUSTED') || res.bodyText.includes('rate limit') || res.bodyText.includes('Quota exceeded')))) {
      console.warn(`[LLM Crawler] Rate limit (HTTP 429) encountered for ${school?.name} with model ${m}. Pausing 10 seconds before retry...`);
      await new Promise(r => setTimeout(r, 10000));
      res = await makeJsonPost(endpoint, {}, exactRequestObj.payload, options.timeoutMs || 20000, options.fetchFn);
      if (res.ok) break;
    }

    // If error is not a 404 NOT_FOUND, do not cycle through other models (e.g. 401/403/429)
    const isNotFound = res.status === 404 || (res.bodyText && (res.bodyText.includes('NOT_FOUND') || res.bodyText.includes('not found')));
    if (!isNotFound) {
      break;
    }
  }

  // Return exact raw response before applying any logic
  const rawApiBody = (res && res.bodyText && res.bodyText.trim().length > 0)
    ? res.bodyText
    : JSON.stringify(res?.json || {
        status: res?.status || 0,
        error: res?.error || `HTTP ${res?.status || 0} returned from Google Gemini`,
        timestamp: new Date().toISOString()
      }, null, 2);

  if (!res.ok) {
    return {
      success: false,
      error: res.json?.error?.message || res.json?.error?.code || `HTTP_${res.status}_ERROR`,
      message: res.json?.error?.message || `Google Gemini API returned HTTP status ${res.status}`,
      provider: 'gemini',
      model: activeModel,
      schoolId: school?.id,
      exactRequest: exactRequestObj,
      exactResponse: {
        status: res.status,
        statusText: `${res.status} Error`,
        rawText: rawApiBody,
        candidateText: rawApiBody,
        parsedJson: res.json,
        timestamp: new Date().toISOString()
      }
    };
  }

  // Extract candidate text from Gemini response structure, iterating across parts if necessary
  let candidateText = '';
  const candidateParts = res.json?.candidates?.[0]?.content?.parts;
  if (Array.isArray(candidateParts) && candidateParts.length > 0) {
    const validParts = candidateParts.filter(p => p && typeof p.text === 'string' && !p.thought);
    if (validParts.length > 0) {
      candidateText = validParts.map(p => p.text).join('\n');
    } else {
      candidateText = candidateParts.map(p => p.text || '').join('\n');
    }
  } else if (typeof res.json?.candidates?.[0]?.content?.text === 'string') {
    candidateText = res.json.candidates[0].content.text;
  } else if (typeof res.json?.text === 'string') {
    candidateText = res.json.text;
  } else {
    candidateText = res.bodyText || '';
  }

  let parsedData = extractJsonFromLlmText(candidateText);
  if (!parsedData && res.bodyText && res.bodyText !== candidateText) {
    parsedData = extractJsonFromLlmText(res.bodyText);
  }

  if (!parsedData) {
    return {
      success: false,
      error: 'JSON_PARSE_ERROR',
      message: 'Google Gemini responded with non-JSON format',
      provider: 'gemini',
      model: activeModel,
      schoolId: school?.id,
      exactRequest: exactRequestObj,
      exactResponse: {
        status: res.status,
        statusText: `${res.status} OK`,
        rawText: rawApiBody,
        candidateText,
        parsedJson: null,
        timestamp: new Date().toISOString()
      }
    };
  }

  return {
    success: true,
    provider: 'gemini',
    model: activeModel,
    schoolId: school?.id,
    data: parsedData,
    exactRequest: exactRequestObj,
    exactResponse: {
      status: res.status,
      statusText: `${res.status} OK`,
      rawText: rawApiBody,
      candidateText,
      parsedJson: parsedData,
      timestamp: new Date().toISOString()
    },
    publicSearchUrl: GEMINI_PUBLIC_SEARCH_URL,
    queryUrl: getGeminiSearchUrl(school, prompt),
    crawledAt: new Date().toISOString()
  };
}

/**
 * Direct OpenAI ChatGPT API Crawler
 */
async function crawlSchoolWithChatGPT(school, options = {}) {
  const settings = db ? db.getSystemSettings() : {};
  const apiKey = options.apiKey !== undefined ? (options.apiKey ? options.apiKey.trim() : null) : (settings.openaiApiKey || process.env.OPENAI_API_KEY || null);
  const model = options.model || settings.openaiModel || 'gpt-4o-mini';
  const promptTemplate = options.promptTemplate || settings.llmPromptTemplate || DEFAULT_LLM_PROMPT_TEMPLATE;
  const prompt = renderPrompt(promptTemplate, school);

  const exactRequestObj = {
    provider: 'chatgpt',
    model,
    endpoint: 'https://api.openai.com/v1/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': apiKey ? `Bearer ${apiKey.slice(0, 7)}...***` : 'Missing'
    },
    promptText: prompt,
    schoolInput: {
      schoolName: school?.name || 'School',
      region: school?.region || school?.la || 'Greater London / UK',
      website: school?.website || 'Not available'
    },
    payload: {
      model,
      messages: [
        { role: 'system', content: 'You are an expert UK School Admissions Data Verifier. Respond strictly with a JSON object matching the requested schema.' },
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1
    },
    timestamp: new Date().toISOString()
  };

  // If mock response provided (for automated tests or offline validation)
  if (options.mockResponse) {
    const rawResponseText = typeof options.mockResponse === 'string' ? options.mockResponse : JSON.stringify(options.mockResponse, null, 2);
    const parsedData = typeof options.mockResponse === 'string' ? extractJsonFromLlmText(options.mockResponse) : options.mockResponse;
    return {
      success: true,
      provider: 'chatgpt',
      model,
      schoolId: school?.id,
      data: parsedData,
      exactRequest: exactRequestObj,
      exactResponse: {
        status: 200,
        statusText: '200 OK',
        rawText: rawResponseText,
        candidateText: rawResponseText,
        parsedJson: parsedData,
        timestamp: new Date().toISOString()
      },
      publicSearchUrl: CHATGPT_PUBLIC_SEARCH_URL,
      queryUrl: getChatGPTSearchUrl(school, prompt),
      crawledAt: new Date().toISOString()
    };
  }

  // Check API Key
  if (!apiKey) {
    const errText = JSON.stringify({
      error: 'NO_OPENAI_API_KEY',
      message: 'OpenAI API key not configured in Admin Settings or OPENAI_API_KEY environment variable'
    }, null, 2);

    return {
      success: false,
      error: 'NO_OPENAI_API_KEY',
      message: 'OpenAI API key not configured. Please enter your API key in Admin Settings > LLM Providers.',
      provider: 'chatgpt',
      model,
      schoolId: school?.id,
      exactRequest: exactRequestObj,
      exactResponse: {
        status: 400,
        statusText: '400 Bad Request (API Key Missing)',
        rawText: errText,
        parsedJson: null,
        timestamp: new Date().toISOString()
      }
    };
  }

  // Execute direct API query
  const endpoint = 'https://api.openai.com/v1/chat/completions';
  const headers = { 'Authorization': `Bearer ${apiKey}` };
  let res = await makeJsonPost(endpoint, headers, exactRequestObj.payload, options.timeoutMs || 15000, options.fetchFn);

  // If rate-limited (HTTP 429), wait 10 seconds and retry once
  if (!res.ok && (res.status === 429 || (res.bodyText && (res.bodyText.includes('rate_limit') || res.bodyText.includes('Rate limit') || res.bodyText.includes('quota'))))) {
    console.warn(`[LLM Crawler] Rate limit (HTTP 429) hit for ${school?.name} with OpenAI ${model}. Pausing 10 seconds before retry...`);
    await new Promise(r => setTimeout(r, 10000));
    res = await makeJsonPost(endpoint, headers, exactRequestObj.payload, options.timeoutMs || 20000, options.fetchFn);
  }

  // Return exact raw response before applying any logic
  const rawApiBody = (res && res.bodyText && res.bodyText.trim().length > 0)
    ? res.bodyText
    : JSON.stringify(res?.json || {
        status: res?.status || 0,
        error: res?.error || `HTTP ${res?.status || 0} returned from OpenAI`,
        timestamp: new Date().toISOString()
      }, null, 2);

  if (!res.ok) {
    return {
      success: false,
      error: res.json?.error?.message || res.json?.error?.code || `HTTP_${res.status}_ERROR`,
      message: res.json?.error?.message || `OpenAI API returned HTTP status ${res.status}`,
      provider: 'chatgpt',
      model,
      schoolId: school?.id,
      exactRequest: exactRequestObj,
      exactResponse: {
        status: res.status,
        statusText: `${res.status} Error`,
        rawText: rawApiBody,
        candidateText: rawApiBody,
        parsedJson: res.json,
        timestamp: new Date().toISOString()
      }
    };
  }

  const messageContent = res.json?.choices?.[0]?.message?.content || res.bodyText;
  let parsedData = extractJsonFromLlmText(messageContent);
  if (!parsedData && res.bodyText && res.bodyText !== messageContent) {
    parsedData = extractJsonFromLlmText(res.bodyText);
  }

  if (!parsedData) {
    return {
      success: false,
      error: 'JSON_PARSE_ERROR',
      message: 'OpenAI ChatGPT responded with non-JSON format',
      provider: 'chatgpt',
      model,
      schoolId: school?.id,
      exactRequest: exactRequestObj,
      exactResponse: {
        status: res.status,
        statusText: `${res.status} OK`,
        rawText: rawApiBody,
        candidateText: messageContent,
        parsedJson: null,
        timestamp: new Date().toISOString()
      }
    };
  }

  return {
    success: true,
    provider: 'chatgpt',
    model,
    schoolId: school?.id,
    data: parsedData,
    exactRequest: exactRequestObj,
    exactResponse: {
      status: res.status,
      statusText: `${res.status} OK`,
      rawText: rawApiBody,
      candidateText: messageContent,
      parsedJson: parsedData,
      timestamp: new Date().toISOString()
    },
    publicSearchUrl: CHATGPT_PUBLIC_SEARCH_URL,
    queryUrl: getChatGPTSearchUrl(school, prompt),
    crawledAt: new Date().toISOString()
  };
}

/**
 * Determine if a new candidate address should replace an existing address.
 * Prevents downgrading detailed full addresses (e.g. "Broadfield Road, London, SE6 1TJ")
 * with basic/coarse ones (e.g. "London" or "Lewisham").
 */
function shouldUpdateAddress(existingAddress, newAddress) {
  if (!newAddress || typeof newAddress !== 'string') return false;
  const next = newAddress.trim();
  if (!next || next === 'N/A' || next === 'null' || next === 'undefined') return false;
  
  if (!existingAddress || typeof existingAddress !== 'string') return true;
  const current = existingAddress.trim();
  if (!current || current === 'N/A' || current === 'null' || current === 'undefined') return true;
  
  // If identical (ignoring whitespace and case), no update needed
  if (current.toLowerCase() === next.toLowerCase()) return false;

  // Street / building indicator regex
  const streetRegex = /\b(\d+[a-z]?|road|rd|street|st|avenue|ave|lane|ln|close|cl|drive|dr|way|crescent|cres|court|ct|gardens|gdns|terrace|terr|hill|walk|place|pl|grove|grv|park|pk|house|hall|square|sq|row|quay|wharf|boulevard|blvd|mews|rise|vale|yard|broadway|bypass|embankment)\b/i;
  
  const currentHasStreet = streetRegex.test(current);
  const nextHasStreet = streetRegex.test(next);

  const currentParts = current.split(/[,;\n]+/).map(p => p.trim()).filter(Boolean);
  const nextParts = next.split(/[,;\n]+/).map(p => p.trim()).filter(Boolean);

  // If next address is just a single word or single component (e.g. "London", "Richmond", "Barnet") and current has multiple components or street details
  if (nextParts.length === 1 && (currentParts.length > 1 || currentHasStreet)) {
    return false;
  }

  // If current has street/building details but next does NOT
  if (currentHasStreet && !nextHasStreet) {
    return false;
  }

  // If current address contains next address as a sub-part and is substantially longer (e.g. "Church Road, Wimbledon, London" vs "London" or "Wimbledon")
  if (current.toLowerCase().includes(next.toLowerCase()) && current.length > next.length + 4) {
    return false;
  }

  // If current address has more components and is longer, and next has fewer components
  if (currentParts.length > nextParts.length && current.length > next.length + 8) {
    return false;
  }

  return true;
}

/**
 * Reconcile and Standardize Raw LLM School Payload
 */
function reconcileLlmSchoolPayload(rawData = {}, school = {}) {
  const reconciled = {};

  // 1. Classification & High-Level Metadata
  if (rawData.schoolType || rawData.type) {
    reconciled.schoolType = String(rawData.schoolType || rawData.type).trim();
  }
  if (rawData.rawSchoolType || rawData.raw_school_type) {
    reconciled.rawSchoolType = String(rawData.rawSchoolType || rawData.raw_school_type).trim();
  }
  if (rawData.gender && (rawData.gender === 'Boys' || rawData.gender === 'Girls' || rawData.gender === 'Mixed')) {
    reconciled.gender = rawData.gender;
  }
  if (rawData.ageRange || rawData.age_range) {
    reconciled.ageRange = String(rawData.ageRange || rawData.age_range).trim();
  }

  // 2. Admissions Overview & Policy Formatted Text
  const rawAdmissionsText = rawData.admissionsOverview || rawData.admissions_overview || rawData.admissionsPolicy || rawData.admissions_policy || rawData.processOverview || rawData.admissionsProcess;
  if (rawAdmissionsText) {
    let formattedAdmissions = String(rawAdmissionsText).trim();
    formattedAdmissions = formattedAdmissions.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/, '').trim();
    reconciled.admissionsPolicy = formattedAdmissions;
  }

  // 3. Contact & Web Presence
  if (rawData.website && String(rawData.website).startsWith('http')) {
    reconciled.website = String(rawData.website).trim();
  }
  if (rawData.phone && String(rawData.phone).trim()) {
    reconciled.phone = String(rawData.phone).trim();
  }
  if (rawData.email && String(rawData.email).includes('@')) {
    reconciled.email = String(rawData.email).trim();
  }
  if (rawData.address && String(rawData.address).trim() && rawData.address !== 'N/A') {
    const candidateAddr = String(rawData.address).trim();
    if (school && school.address && !shouldUpdateAddress(school.address, candidateAddr)) {
      reconciled.address = school.address;
    } else {
      reconciled.address = candidateAddr;
    }
  }
  if (rawData.postcode && String(rawData.postcode).trim() && rawData.postcode !== 'N/A') {
    reconciled.postcode = String(rawData.postcode).trim().toUpperCase();
  }

  // 4. Examination Board & Formats
  if (rawData.entranceExamType || rawData.examType || rawData.examBoard) {
    reconciled.entranceExamType = String(rawData.entranceExamType || rawData.examType || rawData.examBoard).trim();
  }

  // 5. Entrance Exam Dates Object
  let rawDates = {};
  if (rawData.entranceExamDates && typeof rawData.entranceExamDates === 'object') {
    rawDates = { ...rawData.entranceExamDates };
  } else if (typeof rawData.entranceExamDates === 'string') {
    try { rawDates = JSON.parse(rawData.entranceExamDates); } catch (e) {}
  }

  // Helper to normalize multi-date fields to an array of strings (applied strictly to stage 1, stage 2, and interview dates)
  function normalizeMultiDates(val) {
    if (!val) return null;
    if (Array.isArray(val)) {
      const clean = val.map(x => String(x).trim()).filter(x => x && x !== 'N/A' && x !== 'null');
      return clean.length > 0 ? clean : null;
    }
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (!trimmed || trimmed === 'N/A' || trimmed === 'null') return null;
      if (trimmed.includes('\n') || (trimmed.includes(';') && /\d/.test(trimmed))) {
        const split = trimmed.split(/[\n;]+/).map(s => s.trim()).filter(Boolean);
        return split.length > 0 ? split : [trimmed];
      }
      return [trimmed];
    }
    return null;
  }

  // Helper to normalize single-date fields (extracting single scalar string)
  function normalizeSingleDate(val) {
    if (!val) return null;
    if (Array.isArray(val)) {
      const first = val.find(x => x && String(x).trim() && String(x).trim() !== 'N/A' && String(x).trim() !== 'null');
      return first ? String(first).trim() : null;
    }
    const str = String(val).trim();
    return (str && str !== 'N/A' && str !== 'null') ? str : null;
  }

  const rawMultiStage1 = rawDates.stage_one_examDate || rawDates.firstExamDate || rawDates.examDate || rawDates.firstStageExamDate || rawData.stage_one_examDate;
  const rawMultiStage2 = rawDates.stage_two_examDate || rawDates.secondExamDate || rawDates.secondStageExamDate || rawData.stage_two_examDate;
  const rawMultiInterview = rawDates.interviewDates || rawDates.interviewInfo || rawDates.interviewsDate || rawDates.interview || rawData.interviewDates;

  // Reconcile dates milestones
  const cleanDates = {
    registrationOpen: normalizeSingleDate(rawDates.registrationOpen || rawDates.registrationOpens || rawData.registrationOpen),
    registrationDeadline: normalizeSingleDate(rawDates.registrationDeadline || rawDates.registrationCloses || rawDates.registrationCloseDate || rawData.registrationDeadline),
    registrationFee: normalizeSingleDate(rawDates.registrationFee || rawData.registrationFee || rawData.examRegistrationFee || rawData.applicationFee),
    stage_one_examDate: normalizeMultiDates(rawMultiStage1),
    stage_one_format_and_subjects: normalizeSingleDate(rawDates.stage_one_format_and_subjects || rawDates.firstExamSubjects || rawDates.firstExamFormatSubjects || rawData.stage_one_format_and_subjects),
    stage_one_resultDate: normalizeSingleDate(rawDates.stage_one_resultDate || rawDates.firstExamResults || rawDates.firstStageResult || rawData.stage_one_resultDate),
    second_stage_exam_required: normalizeSingleDate(rawDates.second_stage_exam_required || rawDates.secondStageRequired || rawData.second_stage_exam_required || (rawMultiStage2 ? 'Yes' : 'No')),
    stage_two_examDate: normalizeMultiDates(rawMultiStage2),
    stage_two_format_and_subjects: normalizeSingleDate(rawDates.stage_two_format_and_subjects || rawDates.secondExamSubjects || rawDates.secondExamFormatSubjects || rawData.stage_two_format_and_subjects),
    stage_two_resultDate: normalizeSingleDate(rawDates.stage_two_resultDate || rawDates.secondExamResults || rawDates.secondStageResult || rawData.stage_two_resultDate),
    interviewDates: normalizeMultiDates(rawMultiInterview),
    offerDate: normalizeSingleDate(rawDates.offerDate || rawDates.offersDate || rawDates.offersAcceptance || rawDates.resultsDate || rawData.offerDate),
    acceptanceDeadline: normalizeSingleDate(rawDates.acceptanceDeadline || rawDates.offerAcceptByDate || rawDates.offerAcceptBy || rawDates.acceptByDate || rawData.acceptanceDeadline),
    openEvents: normalizeSingleDate(rawDates.openEvents || rawDates.openDayEvening || rawDates.openDays || rawData.openEvents),
    scholarshipsOffered: normalizeSingleDate(rawDates.scholarshipsOffered || rawDates.scholarships || rawData.scholarshipsOffered),
    bursaryDeadline: normalizeSingleDate(rawDates.bursaryDeadline || rawDates.scholarshipDeadline || rawData.bursaryDeadline)
  };

  // Clean empty values
  for (const [k, v] of Object.entries(cleanDates)) {
    if (v === null || v === undefined || v === '' || v === 'N/A' || (Array.isArray(v) && v.length === 0)) {
      delete cleanDates[k];
    }
  }

  reconciled.entranceExamDates = cleanDates;

  // Flattened high-level stage columns in schools table
  if (cleanDates.second_stage_exam_required) {
    reconciled.second_stage_exam_required = cleanDates.second_stage_exam_required.toLowerCase().startsWith('y') ? 'Yes' : 'No';
  }
  if (cleanDates.stage_one_format_and_subjects) {
    reconciled.stage_one_format_and_subjects = cleanDates.stage_one_format_and_subjects;
  }
  if (cleanDates.stage_two_format_and_subjects) {
    reconciled.stage_two_format_and_subjects = cleanDates.stage_two_format_and_subjects;
  }

  // 6. Fees & Financials
  const termlyFeesVal = rawData.feesTermly || rawData.fees_termly || rawData.termlyFees || rawData.feesPerTerm;
  if (termlyFeesVal && String(termlyFeesVal).trim() && String(termlyFeesVal).trim() !== 'null') {
    reconciled.feesTermly = String(termlyFeesVal).trim();
  }

  const regFeeVal = rawData.registrationFee || rawData.registration_fee || rawData.examRegistrationFee || rawData.applicationFee || rawDates.registrationFee || rawDates.registration_fee;
  if (regFeeVal && String(regFeeVal).trim() && String(regFeeVal).trim() !== 'null' && String(regFeeVal).trim() !== 'N/A') {
    reconciled.registrationFee = String(regFeeVal).trim();
    cleanDates.registrationFee = String(regFeeVal).trim();
  }

  // 7. Provenance & Confidence
  const sourceUrlVal = rawData.sourceUrl || rawData.source_url || rawData.source || rawData.verificationSource || rawData.sourceLink;
  if (sourceUrlVal && String(sourceUrlVal).startsWith('http')) {
    reconciled.sourceUrl = String(sourceUrlVal).trim();
  }
  reconciled.confidenceScore = Math.max(70, Math.min(100, parseInt(rawData.confidenceScore, 10) || 95));

  // 8. Rankings in England
  if (rawData.national_rank_england !== undefined) {
    const r = parseInt(rawData.national_rank_england, 10);
    reconciled.national_rank_england = (!isNaN(r) && r > 0) ? r : null;
  }
  if (rawData.gcse_rank_england !== undefined) {
    const r = parseInt(rawData.gcse_rank_england, 10);
    reconciled.gcse_rank_england = (!isNaN(r) && r > 0) ? r : null;
  }
  if (rawData.a_level_rank_england !== undefined) {
    const r = parseInt(rawData.a_level_rank_england, 10);
    reconciled.a_level_rank_england = (!isNaN(r) && r > 0) ? r : null;
  }

  return reconciled;
}

/**
 * Universal LLM Crawler Dispatcher
 */
async function crawlSchoolWithLLM(school, options = {}) {
  const settings = db ? db.getSystemSettings() : {};
  const provider = (options.provider || settings.llmProvider || 'gemini').toLowerCase();

  if (provider === 'chatgpt' || provider === 'openai') {
    return crawlSchoolWithChatGPT(school, options);
  }
  return crawlSchoolWithGemini(school, options);
}

/**
 * Update school database record with verified LLM intelligence
 */
function applyLLMResultToSchool(schoolId, llmResult, adminUser = 'LLM AI Crawler') {
  if (!db) {
    throw new Error('Database module not available');
  }
  if (!llmResult || !llmResult.success || !llmResult.data || llmResult.error || llmResult.exactResponse?.status === 429 || (llmResult.exactResponse?.status && llmResult.exactResponse.status >= 400)) {
    throw new Error(`Invalid or unsuccessful LLM result cannot be applied to school record: ${llmResult?.error || (llmResult?.exactResponse?.status ? `HTTP ${llmResult.exactResponse.status}` : 'Unknown LLM error')}`);
  }

  const sqlite = db.getDb();
  const school = db.getSchoolById(schoolId);
  if (!school) {
    throw new Error(`School with ID "${schoolId}" not found`);
  }

  const rawData = llmResult.data;
  const data = reconcileLlmSchoolPayload(rawData, school);
  const now = new Date().toISOString();

  const dataUpdates = [];
  const dataParams = [];
  const updatedFieldNames = [];

  const cleanDatesJson = JSON.stringify(data.entranceExamDates || {});

  // Helper to compare dates objects deeply
  function areDatesDifferent(oldDatesRaw, newDatesRaw) {
    let oldObj = {};
    let newObj = {};
    try {
      oldObj = typeof oldDatesRaw === 'string' ? JSON.parse(oldDatesRaw) : (oldDatesRaw || {});
    } catch(e) {}
    try {
      newObj = typeof newDatesRaw === 'string' ? JSON.parse(newDatesRaw) : (newDatesRaw || {});
    } catch(e) {}

    const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);
    for (const k of allKeys) {
      if (k === 'second_stage_exam_required') continue;
      const oldV = oldObj[k];
      const newV = newObj[k];
      const oldStr = Array.isArray(oldV) ? oldV.join(', ') : (oldV !== undefined && oldV !== null ? String(oldV).trim() : '');
      const newStr = Array.isArray(newV) ? newV.join(', ') : (newV !== undefined && newV !== null ? String(newV).trim() : '');
      if (newStr && newStr !== 'N/A' && newStr !== 'null' && newStr !== oldStr) {
        return true;
      }
    }
    return false;
  }

  // 1. Entrance Exam Dates
  if (cleanDatesJson && cleanDatesJson !== '{}' && cleanDatesJson !== 'null') {
    if (areDatesDifferent(school.entranceExamDates, data.entranceExamDates)) {
      dataUpdates.push('entranceExamDates = ?');
      dataParams.push(cleanDatesJson);
      updatedFieldNames.push('entranceExamDates');
    }
  }

  // 2. Admissions Policy
  if (data.admissionsPolicy && String(data.admissionsPolicy).trim()) {
    const val = String(data.admissionsPolicy).trim();
    if ((school.admissionsPolicy || '').trim() !== val) {
      dataUpdates.push('admissionsPolicy = ?');
      dataParams.push(val);
      updatedFieldNames.push('admissionsPolicy');
    }
  }

  // 3. Description
  if (data.description && String(data.description).trim()) {
    const val = String(data.description).trim();
    if ((school.description || '').trim() !== val) {
      dataUpdates.push('description = ?');
      dataParams.push(val);
      updatedFieldNames.push('description');
    }
  }

  // 4. Raw School Type
  if (data.rawSchoolType && String(data.rawSchoolType).trim()) {
    const val = String(data.rawSchoolType).trim();
    if ((school.rawSchoolType || '').trim() !== val) {
      dataUpdates.push('rawSchoolType = ?');
      dataParams.push(val);
      updatedFieldNames.push('rawSchoolType');
    }
  }

  // 5. School Type
  if (data.schoolType && String(data.schoolType).trim()) {
    const val = String(data.schoolType).trim();
    if ((school.schoolType || '').trim() !== val) {
      dataUpdates.push('schoolType = ?');
      dataParams.push(val);
      updatedFieldNames.push('schoolType');
    }
  }

  // 6. Gender (Protect established single-sex schools from being erroneously flipped to 'Mixed' without high confidence and verified web presence)
  if (data.gender && (data.gender === 'Boys' || data.gender === 'Girls' || data.gender === 'Mixed')) {
    const currentGender = (school.gender || '').trim();
    let shouldUpdateGender = false;

    if (!currentGender || currentGender === 'N/A') {
      shouldUpdateGender = true;
    } else if (currentGender !== data.gender) {
      if ((currentGender === 'Boys' || currentGender === 'Girls') && data.gender === 'Mixed') {
        const hasVerifiedProof = (data.confidenceScore && data.confidenceScore >= 95) && data.website;
        if (hasVerifiedProof) {
          shouldUpdateGender = true;
        }
      } else {
        shouldUpdateGender = true;
      }
    }

    if (shouldUpdateGender) {
      dataUpdates.push('gender = ?');
      dataParams.push(data.gender);
      updatedFieldNames.push('gender');
    }
  }

  // 7. Age Range
  if (data.ageRange && String(data.ageRange).trim()) {
    const val = String(data.ageRange).trim();
    if ((school.ageRange || '').trim() !== val) {
      dataUpdates.push('ageRange = ?');
      dataParams.push(val);
      updatedFieldNames.push('ageRange');
    }
  }

  // 8. Website
  if (data.website && String(data.website).startsWith('http')) {
    const val = String(data.website).trim();
    if ((school.website || '').trim() !== val) {
      dataUpdates.push('website = ?');
      dataParams.push(val);
      updatedFieldNames.push('website');
    }
  }

  // 9. Phone
  if (data.phone && String(data.phone).trim()) {
    const val = String(data.phone).trim();
    if ((school.phone || '').trim() !== val) {
      dataUpdates.push('phone = ?');
      dataParams.push(val);
      updatedFieldNames.push('phone');
    }
  }

  // 10. Email
  if (data.email && String(data.email).includes('@')) {
    const val = String(data.email).trim();
    if ((school.email || '').trim() !== val) {
      dataUpdates.push('email = ?');
      dataParams.push(val);
      updatedFieldNames.push('email');
    }
  }

  // 11. Address (Preserve detailed address if candidate is only basic/city name)
  if (data.address && shouldUpdateAddress(school.address, data.address)) {
    const val = String(data.address).trim();
    dataUpdates.push('address = ?');
    dataParams.push(val);
    updatedFieldNames.push('address');
  }

  // 12. Postcode
  if (data.postcode && String(data.postcode).trim() && data.postcode !== 'N/A') {
    const val = String(data.postcode).trim().toUpperCase();
    if ((school.postcode || '').trim().toUpperCase() !== val) {
      dataUpdates.push('postcode = ?');
      dataParams.push(val);
      updatedFieldNames.push('postcode');
    }
  }

  // 13. Entrance Exam Type
  if (data.entranceExamType && String(data.entranceExamType).trim()) {
    const val = String(data.entranceExamType).trim();
    if ((school.entranceExamType || '').trim() !== val) {
      dataUpdates.push('entranceExamType = ?');
      dataParams.push(val);
      updatedFieldNames.push('entranceExamType');
    }
  }

  // 14. Fees Termly
  if (data.feesTermly && String(data.feesTermly).trim() && data.feesTermly !== 'null') {
    const val = String(data.feesTermly).trim();
    if ((school.feesTermly || '').trim() !== val) {
      dataUpdates.push('feesTermly = ?');
      dataParams.push(val);
      updatedFieldNames.push('feesTermly');
    }
  }

  // 15. Registration Fee
  if (data.registrationFee && String(data.registrationFee).trim() && data.registrationFee !== 'null') {
    const val = String(data.registrationFee).trim();
    if ((school.registrationFee || '').trim() !== val) {
      dataUpdates.push('registrationFee = ?');
      dataParams.push(val);
      updatedFieldNames.push('registrationFee');
    }
  }

  // 16. Source URL
  if (data.sourceUrl && String(data.sourceUrl).startsWith('http')) {
    const val = String(data.sourceUrl).trim();
    if ((school.sourceUrl || '').trim() !== val) {
      dataUpdates.push('sourceUrl = ?');
      dataParams.push(val);
      updatedFieldNames.push('sourceUrl');
    }
  }

  // 17. Second Stage Exam Required (only if explicitly in rawData or changed from existing)
  if (rawData.second_stage_exam_required !== undefined || rawData.stage2Required !== undefined || rawData.secondStageRequired !== undefined) {
    const val = String(data.second_stage_exam_required).trim();
    if ((school.second_stage_exam_required || '').trim() !== val) {
      dataUpdates.push('second_stage_exam_required = ?');
      dataParams.push(val);
      updatedFieldNames.push('second_stage_exam_required');
    }
  }

  // 18. Stage One Format & Subjects
  if (data.stage_one_format_and_subjects && String(data.stage_one_format_and_subjects).trim()) {
    const val = String(data.stage_one_format_and_subjects).trim();
    if ((school.stage_one_format_and_subjects || '').trim() !== val) {
      dataUpdates.push('stage_one_format_and_subjects = ?');
      dataParams.push(val);
      updatedFieldNames.push('stage_one_format_and_subjects');
    }
  }

  // 19. Stage Two Format & Subjects
  if (data.stage_two_format_and_subjects && String(data.stage_two_format_and_subjects).trim()) {
    const val = String(data.stage_two_format_and_subjects).trim();
    if ((school.stage_two_format_and_subjects || '').trim() !== val) {
      dataUpdates.push('stage_two_format_and_subjects = ?');
      dataParams.push(val);
      updatedFieldNames.push('stage_two_format_and_subjects');
    }
  }

  // 20. National Rank England
  if (rawData.national_rank_england !== undefined && rawData.national_rank_england !== null) {
    const parsedRank = parseInt(data.national_rank_england, 10);
    const validRank = (!isNaN(parsedRank) && parsedRank > 0) ? parsedRank : null;
    if (validRank !== null && school.national_rank_england !== validRank) {
      dataUpdates.push('national_rank_england = ?');
      dataParams.push(validRank);
      updatedFieldNames.push('national_rank_england');
    }
  }

  // 21. GCSE Rank England
  if (rawData.gcse_rank_england !== undefined && rawData.gcse_rank_england !== null) {
    const parsedRank = parseInt(data.gcse_rank_england, 10);
    const validRank = (!isNaN(parsedRank) && parsedRank > 0) ? parsedRank : null;
    if (validRank !== null && school.gcse_rank_england !== validRank) {
      dataUpdates.push('gcse_rank_england = ?');
      dataParams.push(validRank);
      updatedFieldNames.push('gcse_rank_england');
    }
  }

  // 22. A-Level Rank England
  if (rawData.a_level_rank_england !== undefined && rawData.a_level_rank_england !== null) {
    const parsedRank = parseInt(data.a_level_rank_england, 10);
    const validRank = (!isNaN(parsedRank) && parsedRank > 0) ? parsedRank : null;
    if (validRank !== null && school.a_level_rank_england !== validRank) {
      dataUpdates.push('a_level_rank_england = ?');
      dataParams.push(validRank);
      updatedFieldNames.push('a_level_rank_england');
    }
  }

  // STRICT REQUIREMENT: If no fields were added or updated, do NOT mark as llm_enriched
  if (updatedFieldNames.length === 0) {
    console.log(`[LLM Crawler] No new or updated fields found for "${school.name}". Skipping llm_enriched tag.`);
    return {
      success: false,
      reason: 'NO_FIELDS_UPDATED',
      updated: false,
      updatedSchool: school,
      updatedFieldsCount: 0,
      updatedFields: []
    };
  }

  // Combine verification tags ONLY when at least one field was updated
  let existingTags = [];
  if (Array.isArray(school.verification_tags)) {
    existingTags = school.verification_tags;
  } else if (typeof school.verification_tags === 'string' && school.verification_tags) {
    try {
      existingTags = JSON.parse(school.verification_tags);
    } catch (e) {
      existingTags = school.verification_tags.split(',').map(t => t.trim());
    }
  }

  const crawlTag = llmResult.provider === 'chatgpt' ? 'chatgpt_crawl' : 'gemini_crawl';
  const newTags = Array.from(new Set([
    ...existingTags,
    crawlTag,
    'llm_verified',
    'llm_enriched',
    'auto_verified',
    'p0_cycle_current',
    'dates_verified'
  ]));

  const reportPayload = {
    provider: llmResult.provider,
    model: llmResult.model,
    crawledAt: now,
    appliedBy: adminUser,
    confidenceScore: data.confidenceScore || 95,
    sourceUrl: data.sourceUrl || data.website || school.website,
    milestones: data.entranceExamDates || {},
    extractedData: rawData,
    reconciledData: data,
    exactRequest: llmResult.exactRequest || null,
    exactResponse: llmResult.exactResponse || null,
    status: 'llm_enriched',
    updatedFields: updatedFieldNames
  };

  const batchId = `llm_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  let auditLogId = null;

  sqlite.exec('BEGIN TRANSACTION;');
  try {
    const logInfo = sqlite.prepare(`
      INSERT INTO admin_audit_logs (actionType, batchId, schoolId, previousState, newState, appliedBy, appliedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'LLM_CRAWL_APPLY',
      batchId,
      schoolId,
      JSON.stringify(school),
      JSON.stringify({
        ...rawData,
        ...data,
        name: school.name,
        exactRequest: llmResult.exactRequest || null,
        exactResponse: llmResult.exactResponse || null,
        provider: llmResult.provider,
        model: llmResult.model,
        verifiedAt: now,
        updatedFields: updatedFieldNames
      }),
      adminUser,
      now
    );
    auditLogId = Number(logInfo.lastInsertRowid);

    const allUpdates = [...dataUpdates];
    const allParams = [...dataParams];

    allUpdates.push('verification_status = ?');
    allParams.push('llm_enriched');

    allUpdates.push('verification_tags = ?');
    allParams.push(JSON.stringify(newTags));

    allUpdates.push('verification_report = ?');
    allParams.push(JSON.stringify(reportPayload));

    allUpdates.push('verified_at = ?');
    allParams.push(now);

    allUpdates.push('confidence_score = ?');
    allParams.push(Math.max(school.confidence_score || 0, data.confidenceScore || 95));

    allParams.push(schoolId);

    sqlite.prepare(`
      UPDATE schools
      SET ${allUpdates.join(', ')}
      WHERE id = ?
    `).run(...allParams);

    sqlite.exec('COMMIT;');
  } catch (err) {
    sqlite.exec('ROLLBACK;');
    throw err;
  }

  const updatedSchool = db.getSchoolById(schoolId);
  return {
    success: true,
    updated: true,
    schoolId,
    updatedSchool,
    auditLogId,
    batchId,
    tags: newTags,
    previousSchool: school,
    updatedFieldsCount: updatedFieldNames.length,
    updatedFields: updatedFieldNames
  };
}

module.exports = {
  GEMINI_PUBLIC_SEARCH_URL,
  CHATGPT_PUBLIC_SEARCH_URL,
  getGeminiSearchUrl,
  getChatGPTSearchUrl,
  getLLMPublicSearchUrl,
  DEFAULT_LLM_PROMPT_TEMPLATE,
  renderPrompt,
  extractSchoolCityAndCounty,
  extractJsonFromLlmText,
  makeJsonPost,
  reconcileLlmSchoolPayload,
  crawlSchoolWithGemini,
  crawlSchoolWithChatGPT,
  crawlSchoolWithLLM,
  applyLLMResultToSchool,
  shouldUpdateAddress
};
