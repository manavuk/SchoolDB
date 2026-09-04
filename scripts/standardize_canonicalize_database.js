const db = require('../db');

console.log('=== Pillar 1: High-Impact Data Standardization & Canonicalization ===\n');

// 1. Postcode Normalizer
function canonicalizePostcode(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const clean = raw.trim().toUpperCase().replace(/\s+/g, '');
  if (clean.length < 5 || clean.length > 8) return raw.trim();
  // Standard UK outward + inward split
  const outward = clean.slice(0, clean.length - 3);
  const inward = clean.slice(clean.length - 3);
  return `${outward} ${inward}`;
}

// 2. Gender Policy Normalizer
function canonicalizeGender(rawGender) {
  if (!rawGender || typeof rawGender !== 'string') return { gender: null, sixthForm: null };
  const g = rawGender.trim().toLowerCase();

  let gender = 'Mixed';
  let sixthForm = null;

  if (g.includes('boys (11-16)') || g.includes('boys / mixed') || g.includes('boys (11-16), co-ed')) {
    gender = 'Boys';
    sixthForm = 'Co-educational / Mixed Sixth Form (16-18)';
  } else if (g.includes('girls / mixed prep')) {
    gender = 'Girls';
    sixthForm = null;
  } else if (g.startsWith('girl') || g === 'female' || g === 'girls only') {
    gender = 'Girls';
  } else if (g.startsWith('boy') || g === 'male' || g === 'boys only') {
    gender = 'Boys';
  } else if (g.includes('mixed') || g.includes('co-ed') || g.includes('coeducational')) {
    gender = 'Mixed';
  }

  return { gender, sixthForm };
}

// 3. Website URL Canonicalizer
function canonicalizeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  let url = rawUrl.trim();
  if (!url) return null;

  // Add https:// prefix if missing
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = `https://${url}`;
  }

  try {
    const parsed = new URL(url);
    // Lowercase hostname
    parsed.hostname = parsed.hostname.toLowerCase();

    // Strip analytics/tracking params
    const keysToDelete = [];
    parsed.searchParams.forEach((val, key) => {
      if (key.startsWith('utm_') || key === 'fbclid' || key === 'gclid' || key === 'ref') {
        keysToDelete.push(key);
      }
    });
    keysToDelete.forEach(k => parsed.searchParams.delete(k));

    let clean = parsed.toString();
    // Strip trailing slash if path is just / and no query
    if (clean.endsWith('/') && parsed.pathname === '/' && !parsed.search && !parsed.hash) {
      clean = clean.slice(0, -1);
    }
    return clean;
  } catch (err) {
    return url;
  }
}

// 4. Numeric Fee Parser
function extractFeeNumbers(feesTermlyStr) {
  if (!feesTermlyStr || typeof feesTermlyStr !== 'string') {
    return { termly: null, annual: null };
  }
  const match = feesTermlyStr.replace(/,/g, '').match(/\d+/);
  if (!match) return { termly: null, annual: null };
  const num = parseInt(match[0], 10);
  if (num >= 200 && num <= 50000) {
    return {
      termly: num,
      annual: num * 3
    };
  }
  return { termly: null, annual: null };
}

// Execute Standardization across all schools
const allSchools = db.getAllSchools();
console.log(`Processing ${allSchools.length} schools...`);

let postcodesFixed = 0;
let gendersStandardized = 0;
let urlsCanonicalized = 0;
let feesNormalized = 0;

const sqlite = db.getDb();
sqlite.exec('BEGIN TRANSACTION;');

try {
  for (const s of allSchools) {
    const updates = {};
    let hasChange = false;

    // Postcode
    if (s.postcode) {
      const canonicalPc = canonicalizePostcode(s.postcode);
      if (canonicalPc !== s.postcode) {
        updates.postcode = canonicalPc;
        postcodesFixed++;
        hasChange = true;
      }
    }

    // Gender & Sixth Form
    if (s.gender) {
      const { gender: canonicalG, sixthForm } = canonicalizeGender(s.gender);
      if (canonicalG !== s.gender) {
        updates.gender = canonicalG;
        gendersStandardized++;
        hasChange = true;
      }
      if (sixthForm && sixthForm !== s.sixthFormGenderPolicy) {
        updates.sixthFormGenderPolicy = sixthForm;
        hasChange = true;
      }
    }

    // Website URL
    if (s.website) {
      const canonicalWeb = canonicalizeUrl(s.website);
      if (canonicalWeb !== s.website) {
        updates.website = canonicalWeb;
        urlsCanonicalized++;
        hasChange = true;
      }
    }

    // Numeric Fees
    if (s.feesTermly) {
      const { termly, annual } = extractFeeNumbers(s.feesTermly);
      if (termly && (s.fees_termly_gbp !== termly || s.fees_annual_gbp !== annual)) {
        updates.fees_termly_gbp = termly;
        updates.fees_annual_gbp = annual;
        feesNormalized++;
        hasChange = true;
      }
    }

    if (hasChange) {
      db.updateSchool(s.id, updates);
    }
  }

  sqlite.exec('COMMIT;');
  console.log('✓ Database transaction committed successfully.\n');
} catch (err) {
  sqlite.exec('ROLLBACK;');
  console.error('Failed to standardize database:', err);
  process.exit(1);
}

console.log('--- Standardization Metrics ---');
console.log(`- Postcodes Canonicalized: ${postcodesFixed}`);
console.log(`- Gender Policies Standardized: ${gendersStandardized}`);
console.log(`- Website URLs Canonicalized: ${urlsCanonicalized}`);
console.log(`- Numeric Fees Normalized: ${feesNormalized}`);
console.log('\n🎉 Pillar 1 Data Standardization Completed!');
