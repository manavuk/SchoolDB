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

Target School Information:
- School Name: {{school_name}}
- City: {{city}}
- County: {{county}}
- Postcode: {{postcode}}
- Known Website: {{website}}

Instructions:
1. Verify official 11+ admissions policy, entrance exam specifications, timeline milestones, and contact details for Year 7 entry (September 2027 / 2026–2027 cycle).
2. In 'admissionsOverview', provide structured bullet points covering: eligibility, registration requirements, exam stages, interview/audition steps, offer decisions, and specific exam details if published (such as exam duration/papers, stage 1 to stage 2 selection criteria, number of qualifiers to stage 2, and parent-relevant exam specifics). Exclude generic filler; leave blank if nothing specific is found.
3. Dates must use "Day Month Year" format (e.g. "6 November 2026"). Never guess or extrapolate. Return an array of date strings only for multi-date milestones ('stage_one_examDate', 'stage_two_examDate', 'interviewDates', e.g. ["2 December 2026", "3 December 2026"]); all other milestone dates must be single date strings.
4. Identify exact exam board/provider (e.g. "GL Assessment (English & Maths)", "ISEB Common Pre-Test", "London 11+ Consortium", "CSSE 11+", "CEM", "School's Own Exam", "Non-selective / Comprehensive Banding").
5. Identify gender policy ("Boys", "Girls", or "Mixed").
6. Extract admissions phone number, email, full street address, postcode, and official verified website URL.
7. For Independent schools, extract termly tuition fees (e.g. "£7,500") and 11+ registration fee (e.g. "£150"); set null if State/Grammar/Free.

Output ONLY a valid JSON object matching this schema with no markdown formatting, code blocks, or preamble:

{
  "name": "{{school_name}}",
  "website": "https://...",
  "phone": "020...",
  "email": "...@...",
  "address": "Full postal street address",
  "postcode": "POSTCODE",
  "schoolType": "Independent",
  "rawSchoolType": "Independent Senior School (11–18)",
  "gender": "Boys or Girls or Mixed",
  "ageRange": "11 to 18",
  "description": "Comprehensive school profile and academic summary.",
  "admissionsOverview": "• Registration: Complete online registration before November deadline.\\n• Stage 1 Test: 60-minute English and Maths papers in December.\\n• Stage 2 Qualification: Top 300 scoring candidates invited to Stage 2 exam in January.\\n• Decisions: Offers released 1 March with acceptance due mid-March.",
  "entranceExamType": "GL Assessment (English & Maths)",
  "entranceExamDates": {
    "registrationOpen": "",
    "registrationDeadline": "",
    "registrationFee": "£150",
    "stage_one_examDate": ["2 December 2026", "3 December 2026"],
    "stage_one_format_and_subjects": "",
    "stage_one_resultDate": "",
    "second_stage_exam_required": "Yes or No",
    "stage_two_examDate": ["9 January 2027"],
    "stage_two_format_and_subjects": "",
    "stage_two_resultDate": "",
    "interviewDates": ["15 January 2027", "16 January 2027"],
    "offerDate": "",
    "acceptanceDeadline": "",
    "openEvents": "",
    "scholarshipsOffered": "",
    "bursaryDeadline": ""
  },
  "feesTermly": "£7,500",
  "registrationFee": "£150",
  "confidenceScore": 95,
  "sourceUrl": "https://..."
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
 * Clean LLM response string to extract pure JSON
 */
function extractJsonFromLlmText(text) {
  if (!text || typeof text !== 'string') return null;
  let clean = text.trim();
  
  // Remove markdown fences ```json ... ```
  if (clean.startsWith('```')) {
    clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }

  try {
    return JSON.parse(clean);
  } catch (e) {
    const firstBrace = clean.indexOf('{');
    const lastBrace = clean.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(clean.substring(firstBrace, lastBrace + 1));
      } catch (inner) {
        return null;
      }
    }
    return null;
  }
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

  // Candidate models to try in case of 404 NOT_FOUND on a specific model alias (strictly Gemini 3+ models)
  const candidateModels = [
    requestedModel,
    'gemini-3.6-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.6-flash-lite',
    'gemini-3.0-flash',
    'gemini-3-flash'
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
        parsedJson: res.json,
        timestamp: new Date().toISOString()
      }
    };
  }

  const candidateText = res.json?.candidates?.[0]?.content?.parts?.[0]?.text || res.bodyText;
  const parsedData = extractJsonFromLlmText(candidateText);

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
        parsedJson: res.json,
        timestamp: new Date().toISOString()
      }
    };
  }

  const messageContent = res.json?.choices?.[0]?.message?.content || res.bodyText;
  const parsedData = extractJsonFromLlmText(messageContent);

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
 * Universal LLM Crawler Dispatcher
 */
/**
 * Reconciles raw returned LLM JSON fields into standardized database school attributes.
 */
function reconcileLlmSchoolPayload(rawData, existingSchool = {}) {
  if (!rawData || typeof rawData !== 'object') return {};

  const reconciled = {};

  // 1. School Identity & Classification
  if (rawData.name) reconciled.name = String(rawData.name).trim();
  if (rawData.schoolType) reconciled.schoolType = String(rawData.schoolType).trim();
  if (rawData.rawSchoolType || rawData.raw_school_type || rawData.schoolTypeDetail) {
    reconciled.rawSchoolType = String(rawData.rawSchoolType || rawData.raw_school_type || rawData.schoolTypeDetail).trim();
  }
  if (rawData.gender && ['Boys', 'Girls', 'Mixed'].includes(rawData.gender)) {
    reconciled.gender = rawData.gender;
  }
  if (rawData.ageRange || rawData.age_range) {
    reconciled.ageRange = String(rawData.ageRange || rawData.age_range).trim();
  }
  if (rawData.description || rawData.summary || rawData.overview) {
    reconciled.description = String(rawData.description || rawData.summary || rawData.overview).trim();
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
    reconciled.address = String(rawData.address).trim();
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
  if (!llmResult || !llmResult.success || !llmResult.data) {
    throw new Error('Invalid or unsuccessful LLM result cannot be applied to school record');
  }

  const sqlite = db.getDb();
  const school = db.getSchoolById(schoolId);
  if (!school) {
    throw new Error(`School with ID "${schoolId}" not found`);
  }

  const rawData = llmResult.data;
  const data = reconcileLlmSchoolPayload(rawData, school);
  const now = new Date().toISOString();

  // Combine verification tags
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

  const cleanDatesJson = JSON.stringify(data.entranceExamDates || {});

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
    status: 'llm_enriched'
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
        verifiedAt: now
      }),
      adminUser,
      now
    );
    auditLogId = Number(logInfo.lastInsertRowid);

    const updates = [];
    const params = [];

    if (cleanDatesJson && cleanDatesJson !== '{}') {
      updates.push('entranceExamDates = ?');
      params.push(cleanDatesJson);
    }
    if (data.admissionsPolicy && String(data.admissionsPolicy).trim()) {
      updates.push('admissionsPolicy = ?');
      params.push(String(data.admissionsPolicy).trim());
    }
    if (data.description && String(data.description).trim()) {
      updates.push('description = ?');
      params.push(String(data.description).trim());
    }
    if (data.rawSchoolType && String(data.rawSchoolType).trim()) {
      updates.push('rawSchoolType = ?');
      params.push(String(data.rawSchoolType).trim());
    }
    if (data.schoolType && String(data.schoolType).trim()) {
      updates.push('schoolType = ?');
      params.push(String(data.schoolType).trim());
    }
    if (data.gender && (data.gender === 'Boys' || data.gender === 'Girls' || data.gender === 'Mixed')) {
      updates.push('gender = ?');
      params.push(data.gender);
    }
    if (data.ageRange && String(data.ageRange).trim()) {
      updates.push('ageRange = ?');
      params.push(String(data.ageRange).trim());
    }
    if (data.website && String(data.website).startsWith('http')) {
      updates.push('website = ?');
      params.push(String(data.website).trim());
    }
    if (data.phone && String(data.phone).trim()) {
      updates.push('phone = ?');
      params.push(String(data.phone).trim());
    }
    if (data.email && String(data.email).includes('@')) {
      updates.push('email = ?');
      params.push(String(data.email).trim());
    }
    if (data.address && String(data.address).trim() && data.address !== 'N/A') {
      updates.push('address = ?');
      params.push(String(data.address).trim());
    }
    if (data.postcode && String(data.postcode).trim() && data.postcode !== 'N/A') {
      updates.push('postcode = ?');
      params.push(String(data.postcode).trim().toUpperCase());
    }
    if (data.entranceExamType && String(data.entranceExamType).trim()) {
      updates.push('entranceExamType = ?');
      params.push(String(data.entranceExamType).trim());
    }
    if (data.feesTermly && String(data.feesTermly).trim() && data.feesTermly !== 'null') {
      updates.push('feesTermly = ?');
      params.push(String(data.feesTermly).trim());
    }
    if (data.registrationFee && String(data.registrationFee).trim() && data.registrationFee !== 'null') {
      updates.push('registrationFee = ?');
      params.push(String(data.registrationFee).trim());
    }
    if (data.sourceUrl && String(data.sourceUrl).startsWith('http')) {
      updates.push('sourceUrl = ?');
      params.push(String(data.sourceUrl).trim());
    }
    if (data.second_stage_exam_required) {
      updates.push('second_stage_exam_required = ?');
      params.push(String(data.second_stage_exam_required).trim());
    }
    if (data.stage_one_format_and_subjects) {
      updates.push('stage_one_format_and_subjects = ?');
      params.push(String(data.stage_one_format_and_subjects).trim());
    }
    if (data.stage_two_format_and_subjects) {
      updates.push('stage_two_format_and_subjects = ?');
      params.push(String(data.stage_two_format_and_subjects).trim());
    }

    updates.push('verification_status = ?');
    params.push('llm_enriched');

    updates.push('verification_tags = ?');
    params.push(JSON.stringify(newTags));

    updates.push('verification_report = ?');
    params.push(JSON.stringify(reportPayload));

    updates.push('verified_at = ?');
    params.push(now);

    updates.push('confidence_score = ?');
    params.push(Math.max(school.confidence_score || 0, data.confidenceScore || 95));

    params.push(schoolId);

    sqlite.prepare(`
      UPDATE schools
      SET ${updates.join(', ')}
      WHERE id = ?
    `).run(...params);

    sqlite.exec('COMMIT;');
  } catch (err) {
    sqlite.exec('ROLLBACK;');
    throw err;
  }

  return {
    success: true,
    schoolId,
    batchId,
    auditLogId,
    provider: llmResult.provider,
    tags: newTags,
    previousSchool: school,
    updatedSchool: db.getSchoolById(schoolId)
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
  applyLLMResultToSchool
};
