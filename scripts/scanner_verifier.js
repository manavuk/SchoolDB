/**
 * School Admissions Data Verifier, Web Crawler & Auditor
 * 
 * Verifies:
 * 1. Website validity, domain reachability and school name ownership.
 * 2. Contact info (address, email, telephone) matching against school website.
 * 3. 11+ Admission Dates (Registration Open/Close, Exam 1, Results, Exam 2, Interviews, Offers, Acceptance).
 * 4. Exam Type details (GL, ISEB, London Consortium, CSSE, CEM, School-Own, Comprehensive/Non-Selective).
 * 5. Gender details (Boys, Girls, Mixed/Co-educational).
 * 
 * Priority Scanning Queue:
 * London Independent -> Other Independent -> Grammar -> State Comprehensive -> Remaining
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

let db = null;
try {
  db = require('../db');
} catch (e) {}

let llmCrawler = null;
try {
  llmCrawler = require('./llm_crawler');
} catch (e) {}

// Realistic headers for school crawler
const CRAWLER_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 (EduLondon-DB-Verifier/2.0)';

/**
 * Fetch webpage content with timeout, redirect following, and safety guards
 */
async function fetchWebpage(urlString, timeoutMs = 3500, maxRedirects = 2) {
  if (!urlString || typeof urlString !== 'string') {
    return { ok: false, error: 'NO_URL_PROVIDED', status: null, body: '', finalUrl: urlString };
  }

  let formattedUrl = urlString.trim();
  if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
    formattedUrl = 'https://' + formattedUrl;
  }

  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(formattedUrl);
    } catch (e) {
      return resolve({ ok: false, error: 'INVALID_URL_FORMAT', status: null, body: '', finalUrl: formattedUrl });
    }

    const client = parsed.protocol === 'http:' ? http : https;
    const reqOptions = {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
      path: parsed.pathname + (parsed.search || ''),
      method: 'GET',
      headers: {
        'User-Agent': CRAWLER_USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-GB,en;q=0.9',
        'Cache-Control': 'no-cache'
      },
      timeout: timeoutMs,
      rejectUnauthorized: false
    };

    let finished = false;
    const finish = (result) => {
      if (finished) return;
      finished = true;
      resolve(result);
    };

    const req = client.request(reqOptions, (res) => {
      // Handle redirects
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && maxRedirects > 0) {
        let redirectTarget = res.headers.location;
        try {
          redirectTarget = new URL(redirectTarget, formattedUrl).href;
          return resolve(fetchWebpage(redirectTarget, timeoutMs, maxRedirects - 1));
        } catch (e) {
          // fall through
        }
      }

      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        data += chunk;
        if (data.length > 500000) { // Cap at 500KB per page
          req.destroy();
        }
      });
      res.on('end', () => {
        finish({
          ok: res.statusCode >= 200 && res.statusCode < 400,
          status: res.statusCode,
          body: data,
          finalUrl: formattedUrl,
          headers: res.headers
        });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      finish({ ok: false, error: 'CONNECTION_TIMEOUT', status: 408, body: '', finalUrl: formattedUrl });
    });

    req.on('error', (err) => {
      finish({ ok: false, error: err.code || err.message, status: null, body: '', finalUrl: formattedUrl });
    });

    req.end();
  });
}

/**
 * Clean and strip HTML tags into plain text for tokenization & NLP parsing
 */
function cleanHtmlText(html) {
  if (!html) return '';
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract Title, Meta Description, H1 headers from HTML
 */
function extractHtmlMetadata(html) {
  if (!html) return { title: '', description: '', h1s: [] };
  
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : '';

  const metaDescMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i) ||
                         html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i);
  const description = metaDescMatch ? metaDescMatch[1].trim() : '';

  const h1s = [];
  const h1Regex = /<h1[^>]*>([\s\S]*?)<\/h1>/gi;
  let m;
  while ((m = h1Regex.exec(html)) !== null) {
    const text = cleanHtmlText(m[1]);
    if (text) h1s.push(text);
  }

  return { title, description, h1s };
}

/**
 * Verify Website Existence and School Name Ownership
 */
function verifySchoolWebsiteIdentity(school, html, metadata, finalUrl) {
  const schoolName = (school.name || '').toLowerCase().trim();
  const title = (metadata.title || '').toLowerCase();
  const desc = (metadata.description || '').toLowerCase();
  const h1s = (metadata.h1s || []).map(h => h.toLowerCase()).join(' ');
  const combinedMeta = `${title} ${desc} ${h1s} ${cleanHtmlText(html).slice(0, 10000).toLowerCase()}`;

  // Extract core keywords from school name (removing common stop words)
  const stopWords = new Set([
    'school', 'for', 'the', 'and', '&', 'high', 'college', 'academy', 'girls', 'boys', 'grammar',
    'independent', 'of', 'st', 'saint', 'primary', 'secondary', 'cofe', 'ce', 'rc', 'catholic',
    'church', 'england', 'senior', 'junior', 'infant', 'infants', 'nursery', 'prep', 'preparatory',
    'upper', 'lower', 'middle', 'trust', 'federation', 'community', 'free', 'voluntary', 'aided', 'controlled'
  ]);
  let nameKeywords = schoolName
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));

  if (nameKeywords.length === 0) {
    nameKeywords = schoolName
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2);
  }

  let matchedKeywords = 0;
  for (const kw of nameKeywords) {
    if (combinedMeta.includes(kw)) {
      matchedKeywords++;
    }
  }

  const keywordMatchRatio = nameKeywords.length > 0 ? (matchedKeywords / nameKeywords.length) : 1;
  const isDirectNameMatch = combinedMeta.includes(schoolName) || (matchedKeywords > 0 && keywordMatchRatio >= 0.5);

  // Domain squatter or parked domain detection
  const isParkedDomain = /(domain is for sale|buy this domain|parked free|godaddy\.com|hugedomains|sedo\.com)/i.test(combinedMeta);

  if (isParkedDomain) {
    return {
      valid: false,
      tag: 'domain_mismatch',
      reason: 'Domain appears to be a parked domain or listed for sale',
      matchScore: 0
    };
  }

  if (!isDirectNameMatch && nameKeywords.length > 0) {
    return {
      valid: false,
      tag: 'domain_mismatch',
      reason: `Website content does not strongly identify with school name "${school.name}"`,
      matchScore: Math.round(keywordMatchRatio * 100)
    };
  }

  return {
    valid: true,
    tag: null,
    reason: 'Website active and verified to belong to school',
    matchScore: Math.round(Math.max(keywordMatchRatio * 100, 90))
  };
}

/**
 * Filter out aggregator directories, social media, and search portals
 */
function isBlacklistedDomain(urlString) {
  if (!urlString || typeof urlString !== 'string') return true;
  try {
    let clean = urlString.trim();
    if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
      clean = 'https://' + clean;
    }
    const parsed = new URL(clean);
    const host = parsed.hostname.toLowerCase();
    const blacklist = [
      'google.com', 'google.co.uk', 'gstatic.com', 'schema.org', 'w3.org',
      'gov.uk', 'service.gov.uk', 'ofsted.gov.uk', 'education.gov.uk',
      'wikipedia.org', 'wikidata.org', 'wikimedia.org',
      'facebook.com', 'twitter.com', 'x.com', 'instagram.com', 'linkedin.com', 'youtube.com', 'tiktok.com',
      'snobe.co.uk', 'locrating.com', 'theschoolsguide.co.uk', 'schoolguide.co.uk', 'goodschoolsguide.co.uk',
      'tatler.com', 'bing.com', 'yahoo.com', 'duckduckgo.com', 'zoopla.co.uk', 'rightmove.co.uk',
      'yell.com', '192.com', 'companieshouse.gov.uk', 'find-and-update.company-information.service.gov.uk'
    ];
    return blacklist.some(b => host === b || host.endsWith('.' + b));
  } catch (e) {
    return true;
  }
}

/**
 * Extract clean organic search result URLs from Google or DuckDuckGo HTML
 */
function extractSearchResultsUrls(html, source = 'google') {
  if (!html || typeof html !== 'string') return [];
  const urls = [];
  const seenHosts = new Set();

  const hrefRegex = /<a\s+(?:[^>]*?\s+)?href=["']([^"'>]+)["']/gi;
  let match;
  while ((match = hrefRegex.exec(html)) !== null) {
    let rawHref = match[1];
    let candidate = null;

    // Handle Google redirect URLs: /url?q=https://...&sa=...
    if (rawHref.startsWith('/url?q=') || rawHref.startsWith('https://www.google.com/url?q=')) {
      const qPart = rawHref.split('q=')[1];
      if (qPart) {
        candidate = decodeURIComponent(qPart.split('&')[0]);
      }
    } else if (rawHref.includes('uddg=')) {
      // Handle DuckDuckGo redirect: //duckduckgo.com/l/?uddg=https%3A%2F%2F...
      const uddgPart = rawHref.split('uddg=')[1];
      if (uddgPart) {
        candidate = decodeURIComponent(uddgPart.split('&')[0]);
      }
    } else if (rawHref.startsWith('http://') || rawHref.startsWith('https://')) {
      candidate = rawHref;
    }

    if (!candidate) continue;

    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
      const host = parsed.hostname.toLowerCase();

      if (isBlacklistedDomain(candidate) || seenHosts.has(host)) continue;

      // Prefer canonical origin or clean base path (strip tracking params)
      const cleanUrl = parsed.origin + (parsed.pathname === '/' ? '' : parsed.pathname);
      seenHosts.add(host);
      urls.push(cleanUrl);
    } catch (e) {}
  }

  return urls;
}

/**
 * Query Google Search (with DuckDuckGo fallback) to discover potential school websites
 */
async function searchGoogleForSchoolWebsites(school, options = {}) {
  const queryParts = [
    `"${school.name}"`,
    school.la || school.region || '',
    school.postcode || '',
    'official school website'
  ].filter(Boolean);

  const query = queryParts.join(' ');
  const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en&gl=uk`;

  // 1. Try Google Search
  const googleRes = await fetchWebpage(googleUrl, options.timeout || 3500);
  let candidates = [];

  if (googleRes.ok && googleRes.body) {
    candidates = extractSearchResultsUrls(googleRes.body, 'google');
  }

  // 2. Fallback to DuckDuckGo HTML if Google returned 0 candidates
  if (candidates.length === 0) {
    const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const ddgRes = await fetchWebpage(ddgUrl, options.timeout || 3500);
    if (ddgRes.ok && ddgRes.body) {
      candidates = extractSearchResultsUrls(ddgRes.body, 'duckduckgo');
    }
  }

  return candidates;
}

/**
 * Verify if candidate search result website matches the school's identity, address, and contacts
 */
function verifyCandidateWebsiteForSchool(school, candidateUrl, pageResult) {
  if (!pageResult || !pageResult.ok || !pageResult.body) {
    return { isMatch: false, reason: 'Failed to fetch candidate webpage' };
  }

  const html = pageResult.body;
  const metadata = extractHtmlMetadata(html);
  const contactData = extractContactInfoFromHtml(html);
  const text = (metadata.title + ' ' + metadata.description + ' ' + (metadata.h1s || []).join(' ') + ' ' + contactData.rawText).toLowerCase();
  const combinedHeader = `${(metadata.title || '').toLowerCase()} ${(metadata.description || '').toLowerCase()} ${(metadata.h1s || []).join(' ').toLowerCase()}`;

  // 1. Check for parked domain / squatter / directory
  const isParked = /(domain is for sale|buy this domain|parked free|godaddy\.com|hugedomains|sedo\.com|compare schools in|directory of schools)/i.test(text);
  if (isParked) {
    return { isMatch: false, reason: 'Parked domain or directory page' };
  }

  // 2. Name Keyword Match
  const stopWords = new Set([
    'school', 'for', 'the', 'and', '&', 'high', 'college', 'academy', 'girls', 'boys', 'grammar',
    'independent', 'of', 'st', 'saint', 'primary', 'secondary', 'cofe', 'ce', 'rc', 'catholic',
    'church', 'england', 'senior', 'junior', 'infant', 'infants', 'nursery', 'prep', 'preparatory',
    'upper', 'lower', 'middle', 'trust', 'federation', 'community', 'free', 'voluntary', 'aided', 'controlled'
  ]);
  let nameWords = (school.name || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));

  if (nameWords.length === 0) {
    nameWords = (school.name || '')
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2);
  }

  let nameMatchCount = 0;
  for (const w of nameWords) {
    if (combinedHeader.includes(w) || text.includes(w)) {
      nameMatchCount++;
    }
  }
  const nameRatio = nameWords.length > 0 ? (nameMatchCount / nameWords.length) : 0;
  const exactNameMatch = combinedHeader.includes((school.name || '').toLowerCase()) || text.includes((school.name || '').toLowerCase());

  if (!exactNameMatch && (nameMatchCount === 0 || nameRatio < 0.5)) {
    return { isMatch: false, reason: `School name keywords do not sufficiently match (ratio ${Math.round(nameRatio * 100)}%)` };
  }

  // 3. Location / Postcode / Address Match
  let locationMatched = false;
  const matchFactors = [];

  if (school.postcode) {
    const normDbPostcode = school.postcode.toUpperCase().replace(/\s+/g, '');
    const dbOutcode = school.postcode.trim().split(/\s+/)[0].toUpperCase();
    for (const pc of contactData.postcodes) {
      const normPc = pc.toUpperCase().replace(/\s+/g, '');
      if (normPc === normDbPostcode) {
        locationMatched = true;
        matchFactors.push(`Exact Postcode ${school.postcode}`);
        break;
      }
    }
    if (!locationMatched && text.includes(normDbPostcode.toLowerCase())) {
      locationMatched = true;
      matchFactors.push(`Postcode ${school.postcode}`);
    }
    if (!locationMatched && dbOutcode && text.includes(dbOutcode.toLowerCase())) {
      locationMatched = true;
      matchFactors.push(`Postcode Outcode ${dbOutcode}`);
    }
  }

  if (school.la && (text.includes(school.la.toLowerCase()) || combinedHeader.includes(school.la.toLowerCase()))) {
    locationMatched = true;
    matchFactors.push(`Local Authority (${school.la})`);
  }

  if (school.address) {
    const addressKeywords = school.address
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !stopWords.has(w));
    let addrMatches = 0;
    for (const w of addressKeywords) {
      if (text.includes(w)) addrMatches++;
    }
    if (addressKeywords.length > 0 && (addrMatches / addressKeywords.length) >= 0.5) {
      locationMatched = true;
      matchFactors.push('Street Address match');
    }
  }

  // 4. Contact Info Match (Phone / Email)
  let contactMatched = false;
  if (school.phone) {
    const cleanDbPhone = school.phone.replace(/\D/g, '');
    if (cleanDbPhone.length >= 7) {
      for (const p of contactData.phones) {
        const cleanP = p.replace(/\D/g, '');
        if (cleanP.includes(cleanDbPhone) || cleanDbPhone.includes(cleanP) || cleanP.slice(-8) === cleanDbPhone.slice(-8)) {
          contactMatched = true;
          matchFactors.push(`Phone ${school.phone}`);
          break;
        }
      }
    }
  }

  if (school.email) {
    const dbEmailDomain = (school.email.split('@')[1] || '').toLowerCase();
    if (dbEmailDomain && !dbEmailDomain.includes('gmail') && !dbEmailDomain.includes('yahoo') && !dbEmailDomain.includes('hotmail')) {
      for (const e of contactData.emails) {
        if (e.includes(dbEmailDomain)) {
          contactMatched = true;
          matchFactors.push(`Email domain ${dbEmailDomain}`);
          break;
        }
      }
    }
  }

  // Accuracy Verification Guard:
  // Must match school name AND (location matched OR contact matched)
  const isHighConfidence = (exactNameMatch || nameRatio >= 0.75) && (locationMatched || contactMatched);
  const isModerateConfidence = (exactNameMatch || nameRatio >= 0.6) && (locationMatched && contactMatched);

  if (isHighConfidence || isModerateConfidence) {
    return {
      isMatch: true,
      confidenceScore: isHighConfidence ? 92 : 85,
      matchFactors,
      metadata,
      contactData,
      html,
      pageResult
    };
  }

  return {
    isMatch: false,
    reason: `Insufficient secondary attribute matches (Location: ${locationMatched}, Contact: ${contactMatched})`
  };
}

/**
 * Discover and verify a missing school website by inspecting the 1st and 2nd Google search results
 */
async function searchAndDiscoverSchoolWebsite(school, options = {}) {
  let candidates = [];
  if (typeof options.searchFn === 'function') {
    candidates = await options.searchFn(school);
  } else {
    candidates = await searchGoogleForSchoolWebsites(school, options);
  }

  if (!candidates || candidates.length === 0) {
    return { found: false, proposedWebsite: null, reason: 'No candidate websites returned from search' };
  }

  // Inspect the first and second search result
  const topCandidates = candidates.slice(0, 2);

  for (let i = 0; i < topCandidates.length; i++) {
    const candidateUrl = topCandidates[i];
    let pageResult;
    if (typeof options.fetchFn === 'function') {
      pageResult = await options.fetchFn(candidateUrl);
    } else {
      pageResult = await fetchWebpage(candidateUrl, options.timeout || 3500);
    }

    const verification = verifyCandidateWebsiteForSchool(school, candidateUrl, pageResult);
    if (verification.isMatch) {
      return {
        found: true,
        proposedWebsite: candidateUrl,
        matchFactors: verification.matchFactors,
        candidateIndex: i + 1,
        pageResult: verification.pageResult || pageResult,
        metadata: verification.metadata,
        contactData: verification.contactData
      };
    }
  }

  return { found: false, proposedWebsite: null, reason: 'Top 1st and 2nd search results did not match school address/contact details with high confidence' };
}

/**
 * Extract Contact Information from Web HTML (Phones, Emails, Postcodes)
 */
function extractContactInfoFromHtml(html) {
  const text = cleanHtmlText(html);

  // UK Phone Regex (e.g. 020 8123 4567, 01923 123456, +44 20 ...)
  const phoneRegex = /(?:(?:\+44\s?\(0\)\s?|\+44\s?|0)(?:\d{2}\s?\d{4}\s?\d{4}|\d{3}\s?\d{3}\s?\d{4}|\d{4}\s?\d{5,6}|\d{5}\s?\d{4,5}))/g;
  const phones = [];
  let pMatch;
  while ((pMatch = phoneRegex.exec(text)) !== null) {
    const raw = pMatch[0].trim();
    const normalized = raw.replace(/\D/g, '');
    if (normalized.length >= 10 && normalized.length <= 13) {
      if (!phones.includes(raw)) phones.push(raw);
    }
  }

  // Email Regex
  const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
  const emails = [];
  let eMatch;
  while ((eMatch = emailRegex.exec(text)) !== null) {
    const email = eMatch[0].toLowerCase();
    // Exclude generic placeholder domains
    if (!email.includes('example.com') && !email.includes('wixpress.com') && !email.includes('schema.org') && !emails.includes(email)) {
      emails.push(email);
    }
  }

  // UK Postcode Regex
  const postcodeRegex = /\b([Gg][Ii][Rr]\s?0[Aa]{2}|(?:[A-Za-z][0-9]{1,2}|[A-Za-z][A-Ha-hJ-Yj-y][0-9]{1,2}|[A-Za-z][0-9][A-Za-z]|[A-Za-z][A-Ha-hJ-Yj-y][0-9][A-Za-z])\s?[0-9][A-Za-z]{2})\b/g;
  const postcodes = [];
  let pcMatch;
  while ((pcMatch = postcodeRegex.exec(text)) !== null) {
    const pc = pcMatch[0].toUpperCase().replace(/\s+/, ' ');
    if (!postcodes.includes(pc)) postcodes.push(pc);
  }

  return { phones, emails, postcodes, rawText: text };
}

/**
 * Discover Admissions Subpage URL from HTML Links
 */
function findAdmissionsSubpageUrl(html, baseUrl) {
  if (!html || typeof html !== 'string' || !baseUrl) return null;
  try {
    const linkRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi;
    let match;
    const candidates = [];
    while ((match = linkRegex.exec(html)) !== null) {
      const href = match[1].trim();
      const anchorText = match[2].replace(/<[^>]+>/g, '').toLowerCase().trim();
      if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) continue;

      const isAdmissions = /(year 7|11\+|admissions|how to apply|entry|admissions policy|join us)/i.test(anchorText) || /(admissions|year-7|entry|how-to-apply|apply)/i.test(href);
      if (isAdmissions) {
        let fullUrl = href;
        if (!href.startsWith('http://') && !href.startsWith('https://')) {
          const base = new URL(baseUrl);
          fullUrl = new URL(href, base.origin).href;
        }
        if (!candidates.includes(fullUrl)) {
          candidates.push(fullUrl);
        }
      }
    }
    return candidates[0] || null;
  } catch (e) {
    return null;
  }
}

/**
 * Cross-match extracted contact info with database
 */
function verifySchoolContactInfo(school, extracted) {
  const anomalies = [];
  const dbPhone = (school.phone || '').replace(/\D/g, '');
  const dbEmail = (school.email || '').toLowerCase().trim();
  const dbPostcode = (school.postcode || '').toUpperCase().replace(/\s+/g, '');

  let phoneMatched = false;
  if (dbPhone) {
    for (const p of extracted.phones) {
      const norm = p.replace(/\D/g, '');
      if (norm.includes(dbPhone) || dbPhone.includes(norm) || (norm.slice(-8) === dbPhone.slice(-8))) {
        phoneMatched = true;
        break;
      }
    }
  }

  let emailMatched = false;
  if (dbEmail) {
    for (const e of extracted.emails) {
      if (e === dbEmail || e.endsWith(dbEmail.split('@')[1] || '---')) {
        emailMatched = true;
        break;
      }
    }
  }

  let postcodeMatched = false;
  if (dbPostcode) {
    for (const pc of extracted.postcodes) {
      if (pc.replace(/\s+/g, '') === dbPostcode) {
        postcodeMatched = true;
        break;
      }
    }
  }

  // Determine if contact discrepancy exists
  if (extracted.phones.length > 0 && dbPhone && !phoneMatched) {
    anomalies.push({
      type: 'CONTACT_PHONE_MISMATCH',
      field: 'phone',
      dbValue: school.phone,
      webValues: extracted.phones,
      message: `Database phone (${school.phone}) differs from website (${extracted.phones.slice(0, 2).join(', ')})`
    });
  }

  if (extracted.emails.length > 0 && dbEmail && !emailMatched) {
    anomalies.push({
      type: 'CONTACT_EMAIL_MISMATCH',
      field: 'email',
      dbValue: school.email,
      webValues: extracted.emails,
      message: `Database email (${school.email}) differs from website admissions contacts (${extracted.emails.slice(0, 2).join(', ')})`
    });
  }

  if (extracted.postcodes.length > 0 && dbPostcode && !postcodeMatched) {
    anomalies.push({
      type: 'CONTACT_POSTCODE_MISMATCH',
      field: 'postcode',
      dbValue: school.postcode,
      webValues: extracted.postcodes,
      message: `Database postcode (${school.postcode}) differs from website address (${extracted.postcodes.join(', ')})`
    });
  }

  return {
    valid: anomalies.length === 0,
    anomalies,
    extractedPhone: extracted.phones[0] || null,
    extractedEmail: extracted.emails[0] || null,
    extractedPostcode: extracted.postcodes[0] || null
  };
}

/**
 * Verify Exam Type Details from School Website and Policy
 */
function verifyExamTypeDetails(school, text) {
  const anomalies = [];
  const lower = text.toLowerCase();
  const dbExamType = (school.entranceExamType || '').trim();

  // Known exam boards and formats
  const indicators = {
    'GL Assessment': /(gl assessment|gl 11\+|gl test|kent test|bexley 11\+|sutton set)/i,
    'ISEB Common Pre-Test': /(iseb|independent schools examinations board|common pre-test|iseb pre-test)/i,
    'London 11+ Consortium': /(london (?:11\+|eleven plus) consortium|consortium cognitive abilities test)/i,
    'CSSE 11+ Exam': /(csse|consortium of selective schools in essex)/i,
    'CEM Assessment': /(cem 11\+|centre for evaluation and monitoring|cem select)/i,
    'Non-Selective / Comprehensive (Distance & Sibling)': /(non-selective|admissions criteria: distance|faith criteria|sibling criteria|pan criteria)/i
  };

  let detectedType = null;
  for (const [examName, regex] of Object.entries(indicators)) {
    if (regex.test(lower)) {
      detectedType = examName;
      break;
    }
  }

  if (detectedType && dbExamType) {
    const isGlRelated = detectedType === 'GL Assessment' && (dbExamType.includes('GL') || dbExamType.includes('Kent') || dbExamType.includes('SET') || dbExamType.includes('Grammar'));
    const isIsebRelated = detectedType === 'ISEB Common Pre-Test' && (dbExamType.includes('ISEB') || dbExamType.includes('Pre-Test') || dbExamType.includes('Independent'));
    const isLondonRelated = detectedType === 'London 11+ Consortium' && (dbExamType.includes('London') || dbExamType.includes('Consortium'));
    const isCsseRelated = detectedType === 'CSSE 11+ Exam' && (dbExamType.includes('CSSE') || dbExamType.includes('Essex'));
    const isNonSelRelated = detectedType.includes('Non-Selective') && (dbExamType.includes('Non-Selective') || dbExamType.includes('Distance') || dbExamType.includes('Comprehensive') || dbExamType.includes('PAN'));

    if (!isGlRelated && !isIsebRelated && !isLondonRelated && !isCsseRelated && !isNonSelRelated) {
      anomalies.push({
        type: 'EXAM_TYPE_MISMATCH',
        field: 'entranceExamType',
        dbValue: dbExamType,
        detectedValue: detectedType,
        message: `Database exam type (${dbExamType}) appears inconsistent with web references to ${detectedType}`
      });
    }
  }

  return {
    valid: anomalies.length === 0,
    anomalies,
    detectedType
  };
}

/**
 * Verify Gender Policy Details from School Website
 */
function verifyGenderDetails(school, text, metadata) {
  const anomalies = [];
  const combined = `${metadata.title} ${metadata.description} ${text.slice(0, 10000)}`.toLowerCase();
  const dbGender = (school.gender || '').trim();

  let detectedGender = null;

  // Check specific patterns
  const isBoysOnly = /\b(all-boys|boys' school|school for boys|boys only)\b/i.test(combined) && !/\bco-educational sixth form\b/i.test(combined);
  const isGirlsOnly = /\b(all-girls|girls' school|school for girls|girls only)\b/i.test(combined) && !/\bco-educational sixth form\b/i.test(combined);
  const isCoed = /\b(co-educational|co-ed|mixed school|for boys and girls|girls and boys)\b/i.test(combined);

  if (isBoysOnly && !isCoed) {
    detectedGender = 'Boys';
  } else if (isGirlsOnly && !isCoed) {
    detectedGender = 'Girls';
  } else if (isCoed) {
    detectedGender = 'Mixed';
  }

  if (detectedGender && dbGender) {
    if (dbGender.toLowerCase() !== detectedGender.toLowerCase()) {
      // Check if school name clarifies it
      const nameLower = school.name.toLowerCase();
      if ((detectedGender === 'Girls' && nameLower.includes('girls')) || (detectedGender === 'Boys' && nameLower.includes('boys'))) {
        anomalies.push({
          type: 'GENDER_MISMATCH',
          field: 'gender',
          dbValue: dbGender,
          detectedValue: detectedGender,
          message: `Database gender is set to "${dbGender}", but school website indicates "${detectedGender}"`
        });
      }
    }
  }

  return {
    valid: anomalies.length === 0,
    anomalies,
    detectedGender
  };
}

/**
 * Extract and Verify 11+ Admissions Dates from Web Text
 */
function extractAndVerifyAdmissionDates(school, text, options = {}) {
  const anomalies = [];
  const sourceUrl = options.sourceUrl || (school.website && school.website !== 'N/A' && school.website !== 'null' ? school.website : null);
  const lower = text.toLowerCase();
  const hasAdmissionsSection = /(11\+|admissions|year 7 (?:entry|admissions)|entrance examination|registration deadline|exam date|open morning|how to apply|application deadline)/i.test(lower);

  let currentDates = {};
  try {
    currentDates = typeof school.entranceExamDates === 'string' ? JSON.parse(school.entranceExamDates) : (school.entranceExamDates || {});
  } catch (e) {
    currentDates = {};
  }

  if (!hasAdmissionsSection) {
    return {
      hasData: false,
      tag: 'auto_verification_data_missing',
      anomalies: [{
        type: 'DATA_MISSING_ON_WEBSITE',
        field: 'entranceExamDates',
        message: 'School website reachable, but no Year 7 / 11+ admissions dates schedule found on crawled pages'
      }],
      fieldVerifications: {},
      extractedDates: {},
      proposedDates: currentDates,
      sourceUrl
    };
  }

  // Robust date pattern extractor for Year 7 / 11+ entry milestones
  const datePatterns = {
    registrationDeadline: /(?:(?:complete (?:your )?(?:online )?application(?:s)?|submit (?:your )?(?:online )?application(?:s)?|applications? (?:must be |should be )?(?:received|submitted|completed)|apply|register) (?:by|before|no later than)|(?:registration|application) (?:deadline|closing date|closes?|due date)|deadline for (?:registration|admissions|applications|11\+|year 7 (?:entry|admissions)?)|closing date (?:for (?:applications|registration|11\+|year 7))?|last date for (?:registration|applications))[^\n.]{0,60}?(?::|on|by|before|is)?\s*(?:(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday),?\s*)?([0-9]{1,2}(?:st|nd|rd|th)?\s+(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)(?:\s+202[567])?|\b[0-9]{1,2}[\/\-\.][0-9]{1,2}[\/\-\.]202[567]\b|\b31(?:st)?\s+october(?:\s+202[567])?\b)/i,
    registrationOpen: /(?:(?:registration|applications?|portal) (?:opens?|open from|available from|begins?)|accepting (?:applications|registrations) from|apply from)[^\n.]{0,60}?(?::|on|from|is)?\s*(?:(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday),?\s*)?([0-9]{1,2}(?:st|nd|rd|th)?\s+(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)(?:\s+202[567])?|\b[0-9]{1,2}[\/\-\.][0-9]{1,2}[\/\-\.]202[567]\b|\b1(?:st)?\s+september(?:\s+202[567])?\b|\b1(?:st)?\s+may(?:\s+202[567])?\b)/i,
    examDate: /(?:(?:entrance (?:examination|exam|assessment|test)|11\+\s*(?:exam|test|assessment|examination)|first stage (?:test|exam|assessment)|stage 1 (?:exam|test|assessment)|written (?:examination|papers?|assessments?)|examinations?|assessments?) (?:held|take place|on|takes place on|date|is|takes place)|(?:entrance (?:examination|exam|assessment|test)|11\+\s*(?:exam|test|assessment|examination)|first stage (?:test|exam|assessment)|stage 1 (?:exam|test|assessment)|written (?:examination|papers?|assessments?)|examinations?|assessments?)|cognitive abilities test|ISEB (?:common pre-test|test|assessment))[^\n.]{0,60}?(?::|on|takes place|is|will be held|held on)?\s*(?:(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday),?\s*)?([0-9]{1,2}(?:st|nd|rd|th)?\s+(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)(?:\s+202[567])?|\b[0-9]{1,2}[\/\-\.][0-9]{1,2}[\/\-\.]202[567]\b)/i,
    resultsDate: /(?:(?:results|outcomes?|decision letters?) (?:will be |are )?(?:sent|emailed|published|issued|posted|communicated|released)|notification of outcome|admissions decisions?)[^\n.]{0,60}?(?::|on|by|is)?\s*(?:(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday),?\s*)?([0-9]{1,2}(?:st|nd|rd|th)?\s+(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)(?:\s+202[567])?|\b[0-9]{1,2}[\/\-\.][0-9]{1,2}[\/\-\.]202[567]\b|\b(?:early|mid|late\s+)?(?:october|december|january|february)\s+202[67]\b)/i,
    secondExamDate: /(?:(?:stage 2|second stage|round 2|second examination|second entrance test|part 2 assessment|stage two) (?:held|take place|on|takes place on|date|is)|second (?:stage|round) (?:exam|test|assessment))[^\n.]{0,60}?(?::|on|is|held on)?\s*(?:(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday),?\s*)?([0-9]{1,2}(?:st|nd|rd|th)?\s+(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)(?:\s+202[567])?|\b[0-9]{1,2}[\/\-\.][0-9]{1,2}[\/\-\.]202[567]\b)/i,
    interviewInfo: /(?:interviews?(?:\s+(?:held|take place|period|scheduled|dates?))?|invited (?:for|to) (?:an )?interview|interview stage|group activity)[^\n.]{0,60}?(?::|held|take place|on|between|is)?\s*(?:(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday),?\s*)?([0-9]{1,2}(?:st|nd|rd|th)?\s+(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)(?:\s+202[567])?|\b(?:january|february|december)\s+202[67]\b)/i,
    offersAcceptance: /(?:offers (?:posted|sent|emailed|made|released)|offer date|national offer day|acceptance deadline|accept (?:your |the )?place by|acceptances? due|offers and acceptances?)[^\n.]{0,60}?(?::|on|by|is)?\s*(?:(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday),?\s*)?([0-9]{1,2}(?:st|nd|rd|th)?\s+(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)(?:\s+202[567])?|\b1\s+march\s+2027\b|\bmid-feb(?:ruary)?\s+2027\b|\b(?:early|mid|late\s+)?march\s+2027\b)/i
  };

  const extractedDates = {};
  for (const [key, regex] of Object.entries(datePatterns)) {
    const match = text.match(regex);
    if (match && match[1]) {
      let val = match[1].trim();
      // Normalize missing year based on admissions cycle context
      if (!/\b202[4567]\b/.test(val)) {
        if (/september|october|november|december|sep|sept|oct|nov|dec/i.test(val)) {
          val += ' 2026';
        } else if (/january|february|march|april|may|june|july|august|jan|feb|mar|apr|jun|jul|aug/i.test(val)) {
          val += ' 2027';
        }
      }
      extractedDates[key] = val;
    }
  }

  const fieldVerifications = {};
  const proposedDates = { ...currentDates };

  // Field-level verification: compare each extracted website date against database record
  for (const [key, webVal] of Object.entries(extractedDates)) {
    const currentVal = currentDates[key];
    const hasCurrent = currentVal && typeof currentVal === 'string' && currentVal.trim() !== '' && currentVal !== 'N/A' && currentVal !== 'null';

    const isMatch = hasCurrent && (db && typeof db.isSemanticMatch === 'function'
      ? db.isSemanticMatch('dates', currentVal, webVal)
      : (currentVal.toLowerCase().replace(/[^\w]/g, '') === webVal.toLowerCase().replace(/[^\w]/g, '')));

    if (isMatch) {
      fieldVerifications[key] = {
        verified: true,
        status: 'verified',
        dbValue: currentVal,
        webValue: webVal,
        source: 'scanned_website',
        sourceUrl
      };
    } else if (hasCurrent) {
      fieldVerifications[key] = {
        verified: false,
        status: 'discrepancy',
        dbValue: currentVal,
        webValue: webVal,
        source: 'scanned_website',
        sourceUrl
      };

      proposedDates[key] = webVal;

      anomalies.push({
        type: 'DATE_MISMATCH',
        field: key,
        category: 'dates',
        severity: 'medium',
        dbValue: currentVal,
        webValue: webVal,
        proposedValue: webVal,
        message: `School website states "${webVal}", but database has "${currentVal}". Proposing verified web date.`
      });
    } else {
      // Discovered new date milestone not previously in DB (Enrichment)
      fieldVerifications[key] = {
        verified: false,
        status: 'enrichment',
        dbValue: 'N/A',
        webValue: webVal,
        source: 'scanned_website',
        sourceUrl
      };

      proposedDates[key] = webVal;
    }
  }

  return {
    hasData: Object.keys(extractedDates).length > 0,
    tag: anomalies.length === 0 ? (Object.keys(extractedDates).length > 0 ? 'dates_verified' : null) : 'date_mismatch',
    anomalies,
    extractedDates,
    fieldVerifications,
    proposedDates,
    sourceUrl
  };
}

/**
 * Helper to execute LLM fallback if web crawler fails or is incomplete
 */
async function tryLlmFallback(school, result, options) {
  if (!llmCrawler) return false;
  const llmSettings = db ? db.getSystemSettings() : {};
  const targetProvider = (options.provider || llmSettings.llmProvider || 'gemini').toLowerCase();
  const hasKey = options.apiKey || options.mockResponse || (targetProvider === 'chatgpt' ? (llmSettings.openaiApiKey || process.env.OPENAI_API_KEY) : (llmSettings.geminiApiKey || process.env.GEMINI_API_KEY));

  if (hasKey || options.forceLLM || options.useLLM || options.mockResponse) {
    try {
      const llmRes = await llmCrawler.crawlSchoolWithLLM(school, options);
      if (llmRes && llmRes.success && llmRes.data) {
        const providerTag = llmRes.provider === 'chatgpt' ? 'chatgpt_crawl' : 'gemini_crawl';
        result.status = 'auto_verified';
        result.tags = Array.from(new Set([...(result.tags || []).filter(t => t !== 'missing_website' && t !== 'dead_website' && t !== 'auto_verification_data_missing'), 'llm_verified', providerTag, 'auto_verified']));
        result.gemini_crawl = 'success';
        if (llmRes.provider === 'chatgpt') result.chatgpt_crawl = 'success';
        result.confidenceScore = llmRes.data.confidenceScore || 95;
        if (llmRes.data.entranceExamDates) {
          result.proposedDates = llmRes.data.entranceExamDates;
        }
        if (llmRes.data.website) {
          result.website = llmRes.data.website;
          result.proposedWebsite = llmRes.data.website;
        }
        result.llmVerification = llmRes;
        result.anomalies = [];
        return true;
      }
    } catch (llmErr) {
      console.warn('[Scanner Verifier] LLM crawl fallback notice:', llmErr.message);
    }
  }
  return false;
}

/**
 * Basic Data Validation for LLM Admissions Intelligence Responses
 */
function validateLlmResponse(data, school) {
  if (!data || typeof data !== 'object') {
    return { valid: false, reason: 'LLM response is not a valid JSON object' };
  }

  if (!data.name || typeof data.name !== 'string' || data.name.trim().length === 0) {
    return { valid: false, reason: 'Missing school name in LLM response' };
  }

  if (data.entranceExamDates && typeof data.entranceExamDates === 'object') {
    const dates = data.entranceExamDates;
    for (const [key, val] of Object.entries(dates)) {
      if (val && typeof val === 'string') {
        const isFormatField = key.includes('format') || key.includes('subject');
        const maxLen = isFormatField ? 300 : 120;
        if (val.length > maxLen || (!isFormatField && key !== 'second_stage_exam_required' && /^(undefined|null|error|404|NaN)$/i.test(val.trim()))) {
          return { valid: false, reason: `Invalid date format for ${key}: "${val}"` };
        }
      }
    }
  }

  if (data.website && typeof data.website === 'string' && data.website.trim() && data.website !== 'N/A' && data.website !== 'null') {
    if (!data.website.startsWith('http://') && !data.website.startsWith('https://') && !data.website.includes('.')) {
      return { valid: false, reason: `Invalid website URL format: "${data.website}"` };
    }
  }

  if (data.email && typeof data.email === 'string' && data.email.trim() && data.email !== 'N/A' && data.email !== 'null') {
    if (!data.email.includes('@') || !data.email.includes('.')) {
      return { valid: false, reason: `Invalid email format: "${data.email}"` };
    }
  }

  return { valid: true };
}

/**
 * Compute Field-by-Field Visual Delta / Diff between Database State and LLM Intelligence
 */
function computeSchoolDiff(previousSchool = {}, newData = {}, updatedSchool = {}) {
  const diffs = [];

  // 1. Entrance Exam Dates Diff
  let prevDates = {};
  try {
    if (previousSchool.entranceExamDates) {
      prevDates = typeof previousSchool.entranceExamDates === 'string' ? JSON.parse(previousSchool.entranceExamDates) : previousSchool.entranceExamDates;
    }
  } catch (e) {}

  let newDates = {};
  try {
    if (newData && newData.entranceExamDates) {
      newDates = typeof newData.entranceExamDates === 'object' ? newData.entranceExamDates : JSON.parse(newData.entranceExamDates);
    }
  } catch (e) {}

  const dateKeys = [
    { key: 'registrationOpen', aliases: ['registrationOpen'], label: 'Registration Opens' },
    { key: 'registrationDeadline', aliases: ['registrationDeadline'], label: 'Registration Deadline' },
    { key: 'stage_one_examDate', aliases: ['stage_one_examDate', 'examDate', 'stage1ExamDate'], label: 'Stage 1 Exam Date' },
    { key: 'stage_one_format_and_subjects', aliases: ['stage_one_format_and_subjects', 'stage1Format', 'stage_one_format'], label: 'Stage 1 Format & Subjects' },
    { key: 'stage_one_resultDate', aliases: ['stage_one_resultDate', 'resultDate', 'stage1ResultDate'], label: 'Stage 1 Results' },
    { key: 'second_stage_exam_required', aliases: ['second_stage_exam_required', 'stage2Required', 'secondStageRequired'], label: '2nd Stage Required?' },
    { key: 'stage_two_examDate', aliases: ['stage_two_examDate', 'examDate2', 'secondExamDate', 'stage2ExamDate'], label: 'Stage 2 Exam Date' },
    { key: 'stage_two_format_and_subjects', aliases: ['stage_two_format_and_subjects', 'stage2Format', 'stage_two_format'], label: 'Stage 2 Format & Subjects' },
    { key: 'interviewDates', aliases: ['interviewDates', 'interviewDate'], label: 'Admissions Interviews' },
    { key: 'offerDate', aliases: ['offerDate', 'offersDate'], label: 'Offers Posted' },
    { key: 'acceptanceDeadline', aliases: ['acceptanceDeadline'], label: 'Acceptance Deadline' }
  ];

  const formatVal = (v) => Array.isArray(v) ? v.join(', ') : (v !== null && v !== undefined ? String(v).trim() : '');

  const changedDates = [];
  for (const item of dateKeys) {
    let oldV = null;
    for (const alias of item.aliases) {
      if (prevDates[alias] !== undefined && prevDates[alias] !== null) { oldV = prevDates[alias]; break; }
    }
    let newV = null;
    for (const alias of item.aliases) {
      if (newDates[alias] !== undefined && newDates[alias] !== null) { newV = newDates[alias]; break; }
    }

    const formattedOld = formatVal(oldV);
    const formattedNew = formatVal(newV);

    if (formattedNew && formattedNew !== 'N/A' && formattedNew !== 'null' && formattedNew !== formattedOld) {
      changedDates.push({ key: item.key, label: item.label, oldVal: formattedOld || null, newVal: Array.isArray(newV) ? newV : formattedNew });
    }
  }
  if (changedDates.length > 0) {
    diffs.push({
      field: 'entranceExamDates',
      label: '11+ Admissions Milestones',
      type: 'dates',
      changedDates
    });
  }

  // 2. Website URL Diff
  const oldWeb = previousSchool.website || null;
  const newWeb = newData.website || null;
  if (newWeb && newWeb !== 'N/A' && newWeb !== 'null' && newWeb !== oldWeb) {
    diffs.push({ field: 'website', label: 'Website URL', oldVal: oldWeb, newVal: newWeb, type: 'url' });
  }

  // 3. Exam Board / Format Diff
  const oldExam = previousSchool.entranceExamType || null;
  const newExam = newData.entranceExamType || null;
  if (newExam && newExam !== 'Unknown' && newExam !== 'N/A' && newExam !== oldExam) {
    diffs.push({ field: 'entranceExamType', label: 'Exam Board / Format', oldVal: oldExam, newVal: newExam, type: 'text' });
  }

  // 4. Gender Policy Diff
  const oldGender = previousSchool.gender || null;
  const newGender = newData.gender || null;
  if (newGender && newGender !== oldGender) {
    diffs.push({ field: 'gender', label: 'Gender Policy', oldVal: oldGender, newVal: newGender, type: 'badge' });
  }

  // 5. Contact Phone Diff
  const oldPhone = previousSchool.phone || null;
  const newPhone = newData.phone || null;
  if (newPhone && newPhone !== 'N/A' && newPhone !== oldPhone) {
    diffs.push({ field: 'phone', label: 'Contact Phone', oldVal: oldPhone, newVal: newPhone, type: 'text' });
  }

  // 6. Admissions Email Diff
  const oldEmail = previousSchool.email || null;
  const newEmail = newData.email || null;
  if (newEmail && newEmail !== 'N/A' && newEmail !== oldEmail) {
    diffs.push({ field: 'email', label: 'Admissions Email', oldVal: oldEmail, newVal: newEmail, type: 'text' });
  }

  // 7. Termly Tuition Fees Diff (for Independent Schools)
  const oldFees = previousSchool.feesTermly || null;
  const newFees = newData.feesTermly || null;
  if (newFees && newFees !== 'N/A' && newFees !== oldFees) {
    diffs.push({ field: 'feesTermly', label: 'Termly Tuition Fees', oldVal: oldFees, newVal: newFees, type: 'text' });
  }

  // 7b. Registration Fee Diff (for Independent Schools)
  const oldRegFee = previousSchool.registrationFee || null;
  const newRegFee = newData.registrationFee || null;
  if (newRegFee && newRegFee !== 'N/A' && newRegFee !== oldRegFee) {
    diffs.push({ field: 'registrationFee', label: '11+ Registration Fee', oldVal: oldRegFee, newVal: newRegFee, type: 'text' });
  }

  // 8. Address Diff
  const oldAddress = previousSchool.address || null;
  const newAddress = newData.address || null;
  const shouldChangeAddr = llmCrawler && typeof llmCrawler.shouldUpdateAddress === 'function'
    ? llmCrawler.shouldUpdateAddress(oldAddress, newAddress)
    : (newAddress && newAddress !== 'N/A' && newAddress !== oldAddress);
  if (shouldChangeAddr && newAddress && newAddress !== 'N/A' && newAddress !== oldAddress) {
    diffs.push({ field: 'address', label: 'Address', oldVal: oldAddress, newVal: newAddress, type: 'text' });
  }

  // 9. Postcode Diff
  const oldPostcode = previousSchool.postcode || null;
  const newPostcode = newData.postcode || null;
  if (newPostcode && newPostcode !== 'N/A' && newPostcode.toUpperCase() !== (oldPostcode || '').toUpperCase()) {
    diffs.push({ field: 'postcode', label: 'Postcode', oldVal: oldPostcode, newVal: newPostcode, type: 'text' });
  }

  // 10. Admissions Process Overview & Policy Diff
  const oldAdmissions = previousSchool.admissionsPolicy || null;
  const newAdmissions = newData.admissionsOverview || newData.admissionsPolicy || null;
  if (newAdmissions && newAdmissions.trim() && newAdmissions.trim() !== (oldAdmissions || '').trim()) {
    diffs.push({ field: 'admissionsPolicy', label: '11+ Admissions Process Overview', oldVal: oldAdmissions, newVal: newAdmissions, type: 'text' });
  }

  // 11. School Description Summary Diff
  const oldDesc = previousSchool.description || null;
  const newDesc = newData.description || null;
  if (newDesc && newDesc.trim() && newDesc.trim() !== (oldDesc || '').trim()) {
    diffs.push({ field: 'description', label: 'School Description', oldVal: oldDesc, newVal: newDesc, type: 'text' });
  }

  return diffs;
}

/**
 * Full Pipeline Audit for a Single School
 */
async function auditAndVerifySchool(school, options = {}) {
  const isForceRerun = options.forceRerun === true || options.force === true;
  let existingTags = [];
  try {
    if (school.verification_tags) {
      existingTags = typeof school.verification_tags === 'string' ? JSON.parse(school.verification_tags) : school.verification_tags;
    }
  } catch (e) {}

  // Skip schools that have already been llm_enriched unless force rerun is specified
  const isAlreadyEnriched = school.verification_status === 'llm_enriched' || existingTags.includes('llm_enriched');
  if (!isForceRerun && isAlreadyEnriched) {
    let prevReport = null;
    try {
      if (school.verification_report) {
        prevReport = typeof school.verification_report === 'string' ? JSON.parse(school.verification_report) : school.verification_report;
      }
    } catch (e) {}

    const tags = [...new Set([...existingTags, 'skip_cache_llm_enriched'])];
    return {
      schoolId: school.id,
      schoolName: school.name,
      schoolType: school.schoolType,
      region: school.region,
      la: school.la,
      website: school.website || null,
      status: 'llm_enriched',
      tags,
      confidenceScore: school.confidence_score || 95,
      anomalies: [],
      skipped: true,
      skipReason: `Skipped scan: School has already been llm_enriched. Select 'Force Rerun' to re-scan.`,
      skipTag: 'skip_cache_llm_enriched',
      exactRequest: prevReport?.exactRequest || {
        provider: prevReport?.provider || 'gemini',
        model: prevReport?.model || 'gemini-3.6-flash',
        note: 'School was previously enriched. (Select "Force Rerun" to execute fresh live LLM call)',
        schoolInput: {
          schoolName: school.name,
          region: school.region || school.la,
          website: school.website
        }
      },
      exactResponse: prevReport?.exactResponse || {
        status: 200,
        statusText: '200 OK (Cached Intelligence)',
        extractedData: prevReport?.extractedData || school.entranceExamDates,
        note: 'Database record already contains verified AI admissions intelligence.'
      },
      details: {
        domainCheck: null,
        contactCheck: null,
        examTypeCheck: null,
        genderCheck: null,
        datesCheck: null
      },
      verifiedAt: school.verified_at
    };
  }

  // 0. Check Scan Cache / Skip Window (unless options.force === true or forceRerun)
  if (!isForceRerun && school.verified_at) {
    let skipDays = 10;
    if (options.skipDays !== undefined && options.skipDays !== null) {
      skipDays = Math.max(0, parseInt(options.skipDays, 10) || 0);
    } else if (db && typeof db.getSystemSetting === 'function') {
      skipDays = db.getSystemSetting('scannerSkipDays', 10);
    }

    if (skipDays > 0) {
      const verifiedTimestamp = new Date(school.verified_at).getTime();
      const ageMs = Date.now() - verifiedTimestamp;
      const windowMs = skipDays * 24 * 60 * 60 * 1000;

      if (!isNaN(verifiedTimestamp) && ageMs >= 0 && ageMs < windowMs) {
        const ageDays = (ageMs / (24 * 60 * 60 * 1000)).toFixed(1);
        let cachedReport = null;
        try {
          if (school.verification_report) {
            cachedReport = typeof school.verification_report === 'string' ? JSON.parse(school.verification_report) : school.verification_report;
          }
        } catch (e) {}

        const isClean = school.verification_status === 'auto_verified' || existingTags.includes('auto_verified');
        const isDeadOrTimeout = existingTags.includes('dead_website') || school.verification_status === 'dead_website';
        const isMissingWeb = existingTags.includes('missing_website') || school.verification_status === 'missing_website';
        const isDataMissing = existingTags.includes('auto_verification_data_missing') || school.verification_status === 'data_missing';

        let skipTag = 'skip_cache_verified';
        let skipReason = '';

        if (isClean) {
          skipTag = 'skip_cache_verified';
          skipReason = `Skipped scan: Website was verified clean within the active ${skipDays}-day cache window (${ageDays} days ago on ${new Date(school.verified_at).toLocaleDateString('en-GB')}).`;
        } else if (isDeadOrTimeout) {
          skipTag = 'skip_cache_timeout_dead';
          skipReason = `Skipped scan: Website timed out or was unreachable within the active ${skipDays}-day cache window (${ageDays} days ago on ${new Date(school.verified_at).toLocaleDateString('en-GB')}).`;
        } else if (isMissingWeb) {
          skipTag = 'skip_cache_missing_web';
          skipReason = `Skipped scan: Website was confirmed missing within the active ${skipDays}-day cache window (${ageDays} days ago on ${new Date(school.verified_at).toLocaleDateString('en-GB')}).`;
        } else if (isDataMissing) {
          skipTag = 'skip_cache_data_missing';
          skipReason = `Skipped scan: Admissions data confirmed missing on site within the active ${skipDays}-day cache window (${ageDays} days ago).`;
        } else {
          skipTag = 'skip_cache_inspected';
          skipReason = `Skipped scan: Record was audited within the active ${skipDays}-day cache window (${ageDays} days ago on ${new Date(school.verified_at).toLocaleDateString('en-GB')}).`;
        }

        const tags = [...new Set([...existingTags, skipTag])];

        return {
          schoolId: school.id,
          schoolName: school.name,
          schoolType: school.schoolType,
          region: school.region,
          la: school.la,
          website: school.website || null,
          proposedWebsite: cachedReport?.proposedWebsite || school.proposedWebsite || null,
          status: school.verification_status || 'cached',
          tags,
          confidenceScore: school.confidence_score || (isClean ? 98 : (isDeadOrTimeout ? 45 : 70)),
          anomalies: cachedReport?.anomalies || [],
          skipped: true,
          skipReason,
          skipTag,
          details: cachedReport?.details || {
            domainCheck: null,
            contactCheck: null,
            examTypeCheck: null,
            genderCheck: null,
            datesCheck: null
          },
          verifiedAt: school.verified_at
        };
      }
    }
  }

  const maxCrawlTimeoutMs = options.maxCrawlTimeoutMs || options.maxTimeout || 180000; // 3 minutes hard timeout

  let timeoutHandle = null;
  const timeoutPromise = new Promise((resolve) => {
    timeoutHandle = setTimeout(() => {
      resolve({
        schoolId: school.id,
        schoolName: school.name,
        schoolType: school.schoolType,
        region: school.region,
        la: school.la,
        website: school.website || null,
        status: 'crawl_stuck',
        tags: ['crawl_stuck'],
        confidenceScore: 35,
        anomalies: [{
          type: 'CRAWL_STUCK',
          category: 'website',
          severity: 'high',
          message: `Crawler timed out and was stuck for more than 3 minutes on school website (${school.website || 'search discovery'}). Skipped to next school in queue.`
        }],
        details: {
          domainCheck: null,
          contactCheck: null,
          examTypeCheck: null,
          genderCheck: null,
          datesCheck: null
        },
        verifiedAt: new Date().toISOString()
      });
    }, maxCrawlTimeoutMs);
  });

  const performAudit = async () => {
    const result = {
      schoolId: school.id,
      schoolName: school.name,
      schoolType: school.schoolType,
      region: school.region || school.la,
      la: school.la,
      website: school.website || null,
      status: 'unverified',
      tags: [],
      confidenceScore: 70,
      anomalies: [],
      details: {
        domainCheck: null,
        contactCheck: null,
        examTypeCheck: null,
        genderCheck: null,
        datesCheck: null
      },
      verifiedAt: new Date().toISOString()
    };

    // Retrieve active LLM & AI configuration from system settings
    const llmSettings = db ? db.getSystemSettings() : {};
    const provider = (options.provider || llmSettings.llmProvider || 'gemini').toLowerCase();
    const model = options.model || (provider === 'chatgpt' ? (llmSettings.openaiModel || 'gpt-4o-mini') : (llmSettings.geminiModel || 'gemini-3.6-flash'));
    const promptTemplate = options.promptTemplate || llmSettings.llmPromptTemplate || (llmCrawler ? llmCrawler.DEFAULT_LLM_PROMPT_TEMPLATE : '');
    const apiKey = options.apiKey || (provider === 'chatgpt' ? (llmSettings.openaiApiKey || process.env.OPENAI_API_KEY) : (llmSettings.geminiApiKey || process.env.GEMINI_API_KEY));

    // 1. Direct LLM Query Execution (Website Crawling Logic Disabled)
    let llmRes = null;
    if (llmCrawler) {
      try {
        llmRes = await llmCrawler.crawlSchoolWithLLM(school, {
          provider,
          model,
          promptTemplate,
          apiKey,
          mockResponse: options.mockResponse,
          timeoutMs: options.timeout || 15000
        });
      } catch (err) {
        console.warn(`[Background Scanner] LLM query notice for ${school.name}:`, err.message);
      }
    }

    // 2. Process Verified LLM Intelligence
    if (llmRes && llmRes.success && llmRes.data && !llmRes.error && llmRes.exactResponse?.status !== 429 && (!llmRes.exactResponse?.status || llmRes.exactResponse.status < 400)) {
      const data = llmRes.data;
      const validation = validateLlmResponse(data, school);

      if (validation.valid) {
        let updatedDbSchool = null;
        let auditLogId = null;
        let batchId = null;
        let applyRes = null;

        if (llmCrawler) {
          try {
            applyRes = llmCrawler.applyLLMResultToSchool(school.id, llmRes, 'Live Background AI Auditor');
            updatedDbSchool = applyRes?.updatedSchool;
            auditLogId = applyRes?.auditLogId || null;
            batchId = applyRes?.batchId || null;
          } catch (e) {
            console.warn(`[Background Scanner] DB update notice for ${school.name}:`, e.message);
          }
        }

        // ONLY mark as llm_enriched if the DB update succeeded AND at least one field was added/updated
        if (applyRes && applyRes.success && applyRes.updated && applyRes.updatedFieldsCount > 0) {
          const providerTag = llmRes.provider === 'chatgpt' ? 'chatgpt_crawl' : 'gemini_crawl';
          result.status = 'llm_enriched';
          result.tags = Array.from(new Set([
            ...result.tags,
            'llm_enriched',
            'auto_verified',
            'llm_verified',
            providerTag,
            'p0_cycle_current',
            'dates_verified'
          ]));
          result.gemini_crawl = 'success';
          if (llmRes.provider === 'chatgpt') result.chatgpt_crawl = 'success';
          result.llmVerification = llmRes;
          result.confidenceScore = Math.max(75, data.confidenceScore || 95);
          result.proposedDates = data.entranceExamDates || {};
          result.website = data.website || school.website;
          result.auditLogId = auditLogId;
          result.batchId = batchId;
          result.diffs = computeSchoolDiff(school, data, updatedDbSchool);
          result.previousSchool = school;
          result.exactRequest = llmRes.exactRequest || null;
          result.exactResponse = llmRes.exactResponse || null;
          if (updatedDbSchool) {
            result.updatedSchool = updatedDbSchool;
          }
          return result;
        } else {
          // No fields were updated -> preserve existing valid status, do NOT add llm_enriched tag, but clear any old llm_error
          const prevStatus = school.verification_status;
          result.status = (prevStatus && prevStatus !== 'llm_error' && prevStatus !== 'unverified') ? prevStatus : 'auto_verified';
          let prevTags = Array.isArray(school.verification_tags) ? [...school.verification_tags] : [];
          prevTags = prevTags.filter(t => t !== 'llm_error' && t !== 'auto_verification_data_missing' && t !== 'dead_website');
          if (!prevTags.includes('auto_verified') && !prevTags.includes('inspected') && !prevTags.includes('llm_enriched')) {
            prevTags.push('inspected');
          }
          result.tags = prevTags;
          result.diffs = [];
          result.previousSchool = school;
          result.updatedSchool = school;
          result.exactRequest = llmRes.exactRequest || null;
          result.exactResponse = llmRes.exactResponse || null;
          return result;
        }
      }
    }

    // 3. Fallback for test harnesses providing custom searchFn / fetchFn without live API keys
    if (typeof options.fetchFn === 'function' || typeof options.searchFn === 'function') {
      let activeWebsite = school.website && school.website.trim() && school.website !== 'N/A' && school.website !== 'null' ? school.website.trim() : null;
      let pageResult = null;

      if (!activeWebsite && typeof options.searchFn === 'function') {
        const discovery = await searchAndDiscoverSchoolWebsite(school, options);
        if (discovery.found && discovery.proposedWebsite) {
          activeWebsite = discovery.proposedWebsite;
          result.proposedWebsite = activeWebsite;
          result.website = activeWebsite;
          pageResult = discovery.pageResult;
        } else {
          result.status = 'missing_website';
          result.tags.push('missing_website');
          result.confidenceScore = 40;
          result.anomalies.push({
            type: 'MISSING_WEBSITE',
            category: 'website',
            severity: 'high',
            message: `No official school website URL recorded for "${school.name}".`
          });
          return result;
        }
      }

      if (!pageResult && activeWebsite && typeof options.fetchFn === 'function') {
        pageResult = await options.fetchFn(activeWebsite, options.timeout || 3500);
      }

      if (pageResult && pageResult.ok && pageResult.body) {
        const html = pageResult.body;
        const metadata = extractHtmlMetadata(html);
        const domainCheck = verifySchoolWebsiteIdentity(school, html, metadata, pageResult.finalUrl);
        result.details.domainCheck = domainCheck;
        if (!domainCheck.valid) {
          result.tags.push(domainCheck.tag || 'domain_mismatch');
          result.anomalies.push({ type: 'DOMAIN_MISMATCH', category: 'identity', severity: 'high', message: domainCheck.reason });
        }
        if (result.proposedWebsite) {
          result.tags.push('proposed_website');
          result.anomalies.push({ type: 'PROPOSED_WEBSITE', category: 'website', severity: 'medium', field: 'website', proposedValue: activeWebsite, message: `Discovered official website: ${activeWebsite}` });
        }
        const contactData = extractContactInfoFromHtml(html);
        const datesCheck = extractAndVerifyAdmissionDates(school, contactData.rawText, { sourceUrl: activeWebsite });
        result.details.datesCheck = datesCheck;
        if (datesCheck.anomalies) {
          for (const an of datesCheck.anomalies) result.anomalies.push(an);
        }
        result.status = result.anomalies.length === 0 ? 'auto_verified' : (result.tags.includes('proposed_website') && result.anomalies.every(a => a.type === 'PROPOSED_WEBSITE') ? 'auto_verified' : 'has_anomalies');
        result.confidenceScore = result.status === 'auto_verified' ? 95 : Math.max(40, 90 - (result.anomalies.length * 15));
        result.tags.push(result.status === 'auto_verified' ? 'auto_verified' : 'inspected');
        result.tags = [...new Set(result.tags)];
        return result;
      } else if (pageResult && !pageResult.ok) {
        result.status = 'dead_website';
        result.tags.push('missing_website', 'dead_website');
        result.confidenceScore = 45;
        result.anomalies.push({ type: 'DEAD_WEBSITE', category: 'website', severity: 'high', message: `Website is unreachable.` });
        return result;
      }
    }

    // 4. Default when LLM query failed or was not successful
    result.status = llmRes?.error || 'llm_error';
    result.tags = ['llm_error', 'auto_verification_data_missing', school.website ? 'dead_website' : 'missing_website'];
    result.confidenceScore = 40;
    result.diffs = [];
    result.previousSchool = school;
    result.updatedSchool = school;
    result.exactRequest = llmRes?.exactRequest || {
      provider,
      model,
      endpoint: provider === 'chatgpt' ? 'https://api.openai.com/v1/chat/completions' : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      promptText: llmCrawler && typeof llmCrawler.renderPrompt === 'function' ? llmCrawler.renderPrompt(promptTemplate, school) : promptTemplate,
      schoolInput: {
        schoolName: school.name,
        region: school.region || school.la,
        website: school.website
      },
      timestamp: new Date().toISOString()
    };
    result.exactResponse = llmRes?.exactResponse || {
      status: 500,
      statusText: '500 Error',
      rawText: JSON.stringify({
        error: llmRes?.error || 'LLM_QUERY_ERROR',
        message: llmRes?.message || `LLM query using ${provider.toUpperCase()} (${model}) returned an error or non-JSON format.`,
        timestamp: new Date().toISOString()
      }, null, 2)
    };
    result.anomalies.push({
      type: 'LLM_QUERY_ERROR',
      category: 'ai_intelligence',
      severity: 'medium',
      message: llmRes?.message || `LLM query using ${provider.toUpperCase()} (${model}) returned an error or non-JSON format.`
    });
    result.tags = [...new Set(result.tags)];

    return result;
  };

  try {
    const finalResult = await Promise.race([performAudit(), timeoutPromise]);
    return finalResult;
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

/**
 * Priority Ordering Query Generator
 */
function getPriorityGroupQuery(category = 'ALL') {
  switch (category.toUpperCase()) {
    case 'GREATER_LONDON':
    case 'GREATER_LONDON_REGION':
    case 'LONDON':
      return "WHERE (region = 'Greater London' OR la IN ('Camden','Barnet','Westminster','Kensington and Chelsea','Hammersmith and Fulham','Wandsworth','Richmond upon Thames','Kingston upon Thames','Merton','Sutton','Croydon','Bromley','Lewisham','Greenwich','Bexley','Havering','Barking and Dagenham','Redbridge','Newham','Waltham Forest','Haringey','Enfield','Islington','Hackney','Tower Hamlets','Southwark','Lambeth','Hounslow','Ealing','Brent','Harrow','Hillingdon'))";
    case 'LONDON_INDEPENDENT':
      return "WHERE schoolType = 'Independent' AND (region = 'Greater London' OR la IN ('Camden','Barnet','Westminster','Kensington and Chelsea','Hammersmith and Fulham','Wandsworth','Richmond upon Thames','Kingston upon Thames','Merton','Sutton','Croydon','Bromley','Lewisham','Greenwich','Bexley','Havering','Barking and Dagenham','Redbridge','Newham','Waltham Forest','Haringey','Enfield','Islington','Hackney','Tower Hamlets','Southwark','Lambeth','Hounslow','Ealing','Brent','Harrow','Hillingdon'))";
    case 'ALL_INDEPENDENT':
      return "WHERE schoolType = 'Independent'";
    case 'GRAMMAR':
      return "WHERE schoolType = 'Grammar'";
    case 'STATE_COMPREHENSIVE':
      return "WHERE schoolType = 'Comprehensive'";
    default:
      return "";
  }
}

module.exports = {
  fetchWebpage,
  cleanHtmlText,
  extractHtmlMetadata,
  isBlacklistedDomain,
  extractSearchResultsUrls,
  searchGoogleForSchoolWebsites,
  verifyCandidateWebsiteForSchool,
  searchAndDiscoverSchoolWebsite,
  discoverSchoolWebsite: searchAndDiscoverSchoolWebsite,
  findAdmissionsSubpageUrl,
  verifySchoolWebsiteIdentity,
  extractContactInfoFromHtml,
  verifySchoolContactInfo,
  verifyExamTypeDetails,
  verifyGenderDetails,
  extractAndVerifyAdmissionDates,
  auditAndVerifySchool,
  getPriorityGroupQuery,
  computeSchoolDiff
};

