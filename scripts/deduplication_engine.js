const db = require('../db');

console.log('=== Advanced Record Linkage, Deduplication & Queue Routing Engine ===\n');

// Levenshtein & Bigram Dice coefficient string similarity helper
function stringSimilarity(s1, s2) {
  if (!s1 || !s2) return 0;
  const a = s1.toLowerCase().trim();
  const b = s2.toLowerCase().trim();
  if (a === b) return 1;

  const getBigrams = str => {
    const s = new Set();
    for (let i = 0; i < str.length - 1; i++) {
      s.add(str.slice(i, i + 2));
    }
    return s;
  };

  const b1 = getBigrams(a);
  const b2 = getBigrams(b);
  let intersection = 0;
  b1.forEach(bg => { if (b2.has(bg)) intersection++; });

  return (2.0 * intersection) / (b1.size + b2.size || 1);
}

function normalizeNameForDedup(name) {
  if (!name) return '';
  return name.toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\b(the|school|academy|college|high|grammar|community|secondary|for|of|in|gdst)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePostcode(pc) {
  if (!pc) return '';
  return pc.toUpperCase().replace(/\s+/g, '');
}

// Multi-Attribute Overlap Evaluator & Queue Router
function evaluatePairOverlap(s1, s2) {
  const norm1 = normalizeNameForDedup(s1.name);
  const norm2 = normalizeNameForDedup(s2.name);
  
  // 1. Hard Contradiction: Single-Sex Gender Contradiction (e.g. Boys vs Girls on shared campus)
  const g1 = (s1.gender || '').toLowerCase();
  const g2 = (s2.gender || '').toLowerCase();
  const isGenderContradiction = (g1.startsWith('boy') && g2.startsWith('girl')) || (g1.startsWith('girl') && g2.startsWith('boy'));
  if (isGenderContradiction) {
    return {
      isDuplicate: false,
      action: 'sibling_schools',
      reason: 'Different Gender Policy (Single-sex Boys vs Girls on shared campus)'
    };
  }

  // 2. Different official URNs with different postcodes
  const u1 = (s1.urn || '').trim();
  const u2 = (s2.urn || '').trim();
  const pc1 = normalizePostcode(s1.postcode);
  const pc2 = normalizePostcode(s2.postcode);

  if (u1 && u2 && u1 !== u2 && pc1 !== pc2) {
    return {
      isDuplicate: false,
      action: 'distinct_schools',
      reason: 'Distinct DfE Schools with different URNs and postcodes'
    };
  }

  // 3. Shared URN anomaly: Same URN but completely different names & locations
  if (u1 && u2 && u1 === u2) {
    const rawSim = stringSimilarity(norm1, norm2);
    if (pc1 !== pc2 && rawSim < 0.4) {
      return {
        isDuplicate: false,
        action: 'route_to_corrections',
        reason: `Shared DfE URN (${u1}) on completely different schools ('${s1.name}' vs '${s2.name}'). Requires URN correction.`
      };
    }
  }

  // 4. Multi-Attribute Overlap Calculation
  let nameScore = stringSimilarity(norm1, norm2);
  if (norm1 === norm2 || (norm1 && norm2 && (norm1.includes(norm2) || norm2.includes(norm1)))) {
    nameScore = Math.max(nameScore, 0.95);
  }

  let pcScore = 0;
  if (pc1 && pc2) {
    if (pc1 === pc2) {
      pcScore = 1.0;
    } else if (pc1.slice(0, 3) === pc2.slice(0, 3)) {
      pcScore = 0.7;
    }
  }

  const genderScore = (g1 === g2 || !g1 || !g2) ? 1.0 : 0.0;
  const typeScore = (s1.schoolType === s2.schoolType || !s1.schoolType || !s2.schoolType) ? 1.0 : 0.5;

  let urnScore = 0.5;
  if (u1 && u2 && u1 === u2) urnScore = 1.0;
  else if (!u1 || !u2) urnScore = 0.8; // One missing URN (common in legacy scraper imports)

  const compositeScore = (0.35 * nameScore) + (0.30 * pcScore) + (0.15 * genderScore) + (0.10 * typeScore) + (0.10 * urnScore);

  // Criteria for genuine duplicate:
  // - Composite score >= 0.75
  // - Name similarity >= 0.65
  // - Matching or missing postcode
  if (compositeScore >= 0.75 && nameScore >= 0.65 && (pcScore >= 0.7 || !pc1 || !pc2)) {
    return {
      isDuplicate: true,
      action: 'genuine_duplicate',
      compositeScore: Math.round(compositeScore * 100),
      reason: `Significant multi-field overlap: Name (${Math.round(nameScore * 100)}%), Postcode (${Math.round(pcScore * 100)}%), Gender compatible`
    };
  }

  // Partial matches: Route to Data Enrichment or Corrections
  if (nameScore >= 0.60 || pcScore === 1.0) {
    if (!u1 || !u2 || !s1.website || !s2.website) {
      return {
        isDuplicate: false,
        action: 'route_to_enrichment',
        reason: `Partial overlap between '${s1.name}' and '${s2.name}'. Incomplete profile routed for AI crawler enrichment.`
      };
    } else {
      return {
        isDuplicate: false,
        action: 'route_to_corrections',
        reason: `Co-located / Similar records with conflicting details ('${s1.name}' vs '${s2.name}'). Routed to Data Corrections.`
      };
    }
  }

  return { isDuplicate: false, action: 'distinct_schools', reason: 'Insufficient overlap' };
}

// Find genuine duplicates and route partial matches to appropriate queues
function findGenuineDuplicatesAndRoute() {
  const allSchools = db.getAllSchools();
  console.log(`Scanning ${allSchools.length} schools with multi-attribute overlap algorithm...`);

  const reviewedPairKeys = (typeof db.getReviewedDuplicatePairKeys === 'function')
    ? db.getReviewedDuplicatePairKeys()
    : new Set();

  const genuineDuplicates = [];
  const correctionsQueue = [];
  const enrichmentQueue = [];
  const visited = new Set();

  // 1. Group by URN
  const byUrn = {};
  for (const s of allSchools) {
    if (s.urn && s.urn.trim()) {
      const u = s.urn.trim();
      if (!byUrn[u]) byUrn[u] = [];
      byUrn[u].push(s);
    }
  }

  for (const [urn, group] of Object.entries(byUrn)) {
    if (group.length > 1) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const canonicalKey = [group[i].id, group[j].id].sort().join('::');
          if (reviewedPairKeys.has(canonicalKey)) continue;

          const key = `${group[i].id}::${group[j].id}`;
          if (!visited.has(key)) {
            visited.add(key);
            const evaluation = evaluatePairOverlap(group[i], group[j]);
            if (evaluation.isDuplicate) {
              genuineDuplicates.push({ pairId: canonicalKey, schoolA: group[i], schoolB: group[j], ...evaluation });
            } else if (evaluation.action === 'route_to_corrections') {
              correctionsQueue.push({ pairId: canonicalKey, schoolA: group[i], schoolB: group[j], ...evaluation });
            } else if (evaluation.action === 'route_to_enrichment') {
              enrichmentQueue.push({ pairId: canonicalKey, schoolA: group[i], schoolB: group[j], ...evaluation });
            }
          }
        }
      }
    }
  }

  // 2. Group by Postcode
  const byPostcode = {};
  for (const s of allSchools) {
    if (s.postcode && s.postcode.trim()) {
      const pc = normalizePostcode(s.postcode);
      if (!byPostcode[pc]) byPostcode[pc] = [];
      byPostcode[pc].push(s);
    }
  }

  for (const [pc, group] of Object.entries(byPostcode)) {
    if (group.length > 1) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const canonicalKey = [group[i].id, group[j].id].sort().join('::');
          if (reviewedPairKeys.has(canonicalKey)) continue;

          const key = `${group[i].id}::${group[j].id}`;
          if (!visited.has(key)) {
            visited.add(key);
            const evaluation = evaluatePairOverlap(group[i], group[j]);
            if (evaluation.isDuplicate) {
              genuineDuplicates.push({ pairId: canonicalKey, schoolA: group[i], schoolB: group[j], ...evaluation });
            } else if (evaluation.action === 'route_to_corrections') {
              correctionsQueue.push({ pairId: canonicalKey, schoolA: group[i], schoolB: group[j], ...evaluation });
            } else if (evaluation.action === 'route_to_enrichment') {
              enrichmentQueue.push({ pairId: canonicalKey, schoolA: group[i], schoolB: group[j], ...evaluation });
            }
          }
        }
      }
    }
  }

  return { genuineDuplicates, correctionsQueue, enrichmentQueue };
}

// Unify genuine duplicate pair safely
function mergeDuplicatePair(schoolA, schoolB) {
  const scoreA = (schoolA.urn ? 50 : 0) + (schoolA.ofstedRating ? 20 : 0) + (schoolA.website ? 10 : 0) + (schoolA.phone ? 10 : 0) + (schoolA.confidence_score || 0);
  const scoreB = (schoolB.urn ? 50 : 0) + (schoolB.ofstedRating ? 20 : 0) + (schoolB.website ? 10 : 0) + (schoolB.phone ? 10 : 0) + (schoolB.confidence_score || 0);

  const primary = scoreA >= scoreB ? { ...schoolA } : { ...schoolB };
  const secondary = scoreA >= scoreB ? schoolB : schoolA;

  const fields = ['urn', 'website', 'phone', 'email', 'address', 'postcode', 'ofstedRating', 'schoolType', 'gender', 'ageRange', 'pupilCount', 'feesTermly', 'fees_termly_gbp', 'fees_annual_gbp', 'entranceExamType', 'description', 'national_rank_england', 'gcseProgress8', 'gcseAttainment8'];
  for (const f of fields) {
    if ((!primary[f] || primary[f] === '') && secondary[f]) {
      primary[f] = secondary[f];
    }
  }

  const datesA = primary.entranceExamDates || {};
  const datesB = secondary.entranceExamDates || {};
  primary.entranceExamDates = { ...datesB, ...datesA };

  primary.dedupNote = `Merged with ${secondary.name} (${secondary.id}) on ${new Date().toISOString()}`;

  db.updateSchool(primary.id, primary);
  db.deleteSchool(secondary.id);

  return { primaryId: primary.id, secondaryId: secondary.id, mergedName: primary.name };
}

if (require.main === module) {
  const { genuineDuplicates, correctionsQueue, enrichmentQueue } = findGenuineDuplicatesAndRoute();

  console.log('=== ADVANCED DEDUPLICATION AUDIT REPORT ===\n');
  console.log(`✓ Genuine Duplicates Found (Significant Overlap): ${genuineDuplicates.length}`);
  console.log(`⚠️ Routed to Data Corrections Queue (Conflicting Identifiers): ${correctionsQueue.length}`);
  console.log(`⏳ Routed to Data Enrichment Queue (Partial Match Pending Crawl): ${enrichmentQueue.length}\n`);

  console.log('--- GENUINE DUPLICATE CANDIDATE PAIRS ---');
  genuineDuplicates.forEach((d, idx) => {
    console.log(`\n[Pair #${idx + 1}] Overlap Score: ${d.compositeScore}%`);
    console.log(`  • Primary (A): ${d.schoolA.name} (${d.schoolA.id}) | Postcode: ${d.schoolA.postcode} | URN: ${d.schoolA.urn || 'none'}`);
    console.log(`  • Candidate (B): ${d.schoolB.name} (${d.schoolB.id}) | Postcode: ${d.schoolB.postcode} | URN: ${d.schoolB.urn || 'none'}`);
  });
}

module.exports = {
  evaluatePairOverlap,
  findGenuineDuplicatesAndRoute,
  mergeDuplicatePair
};
