const db = require('../db');

function stringSimilarity(s1, s2) {
  if (!s1 || !s2) return 0;
  const a = s1.toLowerCase().trim();
  const b = s2.toLowerCase().trim();
  if (a === b) return 1;
  const getBigrams = str => {
    const s = new Set();
    for (let i = 0; i < str.length - 1; i++) s.add(str.slice(i, i + 2));
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

function evaluatePairOverlap(s1, s2) {
  const norm1 = normalizeNameForDedup(s1.name);
  const norm2 = normalizeNameForDedup(s2.name);
  
  // 1. Hard Contradiction Checks
  const g1 = (s1.gender || '').toLowerCase();
  const g2 = (s2.gender || '').toLowerCase();
  const isGenderContradiction = (g1.startsWith('boy') && g2.startsWith('girl')) || (g1.startsWith('girl') && g2.startsWith('boy'));
  if (isGenderContradiction) {
    return { isDuplicate: false, action: 'sibling_schools', reason: 'Different Gender Policy (Single-sex Boys vs Girls on shared campus)' };
  }

  // 2. Different URNs with different postcodes
  const u1 = (s1.urn || '').trim();
  const u2 = (s2.urn || '').trim();
  const pc1 = normalizePostcode(s1.postcode);
  const pc2 = normalizePostcode(s2.postcode);

  if (u1 && u2 && u1 !== u2 && pc1 !== pc2) {
    return { isDuplicate: false, action: 'distinct_schools', reason: 'Distinct DfE Schools with different URNs and postcodes' };
  }

  // 3. Shared URN but completely different names & postcodes
  if (u1 && u2 && u1 === u2) {
    const rawSim = stringSimilarity(norm1, norm2);
    if (pc1 !== pc2 && rawSim < 0.4) {
      return {
        isDuplicate: false,
        action: 'route_to_corrections',
        reason: `Shared URN (${u1}) but different schools ('${s1.name}' vs '${s2.name}'). Needs URN correction.`
      };
    }
  }

  // 4. Calculate Detailed Overlap Score
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
  else if (!u1 || !u2) urnScore = 0.8; // One missing URN (common in scraper imports)

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

  // Partial match that should be queued for enrichment or corrections
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
        reason: `Similar records with conflicting details ('${s1.name}' vs '${s2.name}'). Routed to Data Corrections.`
      };
    }
  }

  return { isDuplicate: false, action: 'distinct_schools', reason: 'Insufficient overlap' };
}

const allSchools = db.getAllSchools();
console.log(`Evaluating duplicate and routing accuracy across ${allSchools.length} schools...\n`);

const genuineDuplicates = [];
const correctionsQueue = [];
const enrichmentQueue = [];
const visited = new Set();

// 1. Test against by-URN clusters
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
        const key = `${group[i].id}::${group[j].id}`;
        if (!visited.has(key)) {
          visited.add(key);
          const evaluation = evaluatePairOverlap(group[i], group[j]);
          if (evaluation.isDuplicate) {
            genuineDuplicates.push({ schoolA: group[i], schoolB: group[j], ...evaluation });
          } else if (evaluation.action === 'route_to_corrections') {
            correctionsQueue.push({ schoolA: group[i], schoolB: group[j], ...evaluation });
          } else if (evaluation.action === 'route_to_enrichment') {
            enrichmentQueue.push({ schoolA: group[i], schoolB: group[j], ...evaluation });
          }
        }
      }
    }
  }
}

// 2. Test against by-Postcode clusters
const byPostcode = {};
for (const s of allSchools) {
  if (s.postcode && s.postcode.trim()) {
    const pc = s.postcode.trim().toUpperCase().replace(/\s+/g, '');
    if (!byPostcode[pc]) byPostcode[pc] = [];
    byPostcode[pc].push(s);
  }
}

for (const [pc, group] of Object.entries(byPostcode)) {
  if (group.length > 1) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const key = `${group[i].id}::${group[j].id}`;
        if (!visited.has(key)) {
          visited.add(key);
          const evaluation = evaluatePairOverlap(group[i], group[j]);
          if (evaluation.isDuplicate) {
            genuineDuplicates.push({ schoolA: group[i], schoolB: group[j], ...evaluation });
          } else if (evaluation.action === 'route_to_corrections') {
            correctionsQueue.push({ schoolA: group[i], schoolB: group[j], ...evaluation });
          } else if (evaluation.action === 'route_to_enrichment') {
            enrichmentQueue.push({ schoolA: group[i], schoolB: group[j], ...evaluation });
          }
        }
      }
    }
  }
}

console.log('=== EVALUATION SUMMARY ===');
console.log(`- Genuine Duplicates (Significant Overlap): ${genuineDuplicates.length}`);
console.log(`- Routed to Data Corrections Queue (Conflicting Identifiers): ${correctionsQueue.length}`);
console.log(`- Routed to Data Enrichment Queue (Partial Match Pending Crawl): ${enrichmentQueue.length}`);

console.log('\n--- 1. Sample Genuine Duplicates ---');
genuineDuplicates.forEach((d, idx) => {
  console.log(`[Duplicate #${idx + 1}] Overlap Score: ${d.compositeScore}%`);
  console.log(`  • A: ${d.schoolA.name} (${d.schoolA.id}) | Postcode: ${d.schoolA.postcode} | URN: ${d.schoolA.urn || 'none'}`);
  console.log(`  • B: ${d.schoolB.name} (${d.schoolB.id}) | Postcode: ${d.schoolB.postcode} | URN: ${d.schoolB.urn || 'none'}`);
});

console.log('\n--- 2. Sample Corrections Queue (Non-duplicates with conflicts) ---');
correctionsQueue.forEach((c, idx) => {
  console.log(`[Correction #${idx + 1}] Reason: ${c.reason}`);
  console.log(`  • A: ${c.schoolA.name} (${c.schoolA.id}) | Postcode: ${c.schoolA.postcode}`);
  console.log(`  • B: ${c.schoolB.name} (${c.schoolB.id}) | Postcode: ${c.schoolB.postcode}`);
});
