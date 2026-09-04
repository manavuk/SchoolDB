const db = require('../db');
const completenessEngine = require('./completeness_engine');
const { TOP_RANKED_SCHOOLS_DATASET, getTop100GcseSchools, getTop100ALevelSchools } = require('./top_rankings_dataset');

function normalizeStr(str) {
  if (!str) return '';
  return str.toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\b(the|school|college|grammar|high|girls|boys|academy|gdst|independent|secondary|preparatory|prep)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePostcode(pc) {
  if (!pc) return '';
  return pc.toUpperCase().replace(/\s+/g, '');
}

function getOutcode(pc) {
  if (!pc) return '';
  const clean = pc.toUpperCase().trim();
  const match = clean.match(/^([A-Z]{1,2}\d[A-Z\d]?)/);
  return match ? match[1] : clean.split(' ')[0];
}

function calculateStringSimilarity(s1, s2) {
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

/**
 * Match a ranked entry against the schools database
 */
function findMatchingDbSchool(rankedEntry, allDbSchools) {
  const targetUrn = (rankedEntry.urn || '').trim();
  const targetPostcode = normalizePostcode(rankedEntry.postcode);
  const targetOutcode = getOutcode(rankedEntry.postcode);
  const targetNormName = normalizeStr(rankedEntry.name);

  // Tier 1: Match by exact full Postcode + Name similarity >= 0.35
  if (targetPostcode) {
    const pcMatches = allDbSchools.filter(s => normalizePostcode(s.postcode) === targetPostcode);
    if (pcMatches.length === 1) {
      const sim = calculateStringSimilarity(normalizeStr(pcMatches[0].name), targetNormName);
      let aliasSim = 0;
      if (Array.isArray(rankedEntry.aliases)) {
        for (const al of rankedEntry.aliases) {
          aliasSim = Math.max(aliasSim, calculateStringSimilarity(normalizeStr(pcMatches[0].name), normalizeStr(al)));
        }
      }
      if (sim >= 0.35 || aliasSim >= 0.35) {
        return { school: pcMatches[0], matchType: 'POSTCODE_EXACT_NAME_CONFIRMED', confidence: 0.99 };
      }
    } else if (pcMatches.length > 1) {
      let best = null;
      let bestScore = -1;
      for (const s of pcMatches) {
        let sim = calculateStringSimilarity(normalizeStr(s.name), targetNormName);
        if (Array.isArray(rankedEntry.aliases)) {
          for (const al of rankedEntry.aliases) {
            sim = Math.max(sim, calculateStringSimilarity(normalizeStr(s.name), normalizeStr(al)));
          }
        }
        if (sim > bestScore) {
          bestScore = sim;
          best = s;
        }
      }
      if (best && bestScore >= 0.35) {
        return { school: best, matchType: 'POSTCODE_BEST_NAME', confidence: 0.95 };
      }
    }
  }

  // Tier 2: Match by exact full name + Outcode or Region match
  const exactNameMatches = allDbSchools.filter(s => s.name.toLowerCase().trim() === rankedEntry.name.toLowerCase().trim());
  if (exactNameMatches.length === 1) {
    return { school: exactNameMatches[0], matchType: 'NAME_EXACT_UNIQUE', confidence: 0.95 };
  } else if (exactNameMatches.length > 1 && targetOutcode) {
    const outMatch = exactNameMatches.find(s => getOutcode(s.postcode) === targetOutcode);
    if (outMatch) return { school: outMatch, matchType: 'NAME_EXACT_OUTCODE', confidence: 0.98 };
  }

  // Tier 3: Match by DfE URN IF name similarity >= 0.40
  if (targetUrn) {
    const urnMatch = allDbSchools.find(s => s.urn && String(s.urn).trim() === targetUrn);
    if (urnMatch) {
      const sim = calculateStringSimilarity(normalizeStr(urnMatch.name), targetNormName);
      if (sim >= 0.40) {
        return { school: urnMatch, matchType: 'URN_EXACT_CONFIRMED', confidence: 0.95 };
      }
    }
  }

  // Tier 4: Match by Outcode + high name similarity
  if (targetOutcode) {
    const outcodeMatches = allDbSchools.filter(s => getOutcode(s.postcode) === targetOutcode);
    for (const s of outcodeMatches) {
      const sim = calculateStringSimilarity(normalizeStr(s.name), targetNormName);
      if (sim >= 0.65) {
        return { school: s, matchType: 'OUTCODE_NAME_MATCH', confidence: 0.85 };
      }
      if (Array.isArray(rankedEntry.aliases)) {
        for (const alias of rankedEntry.aliases) {
          const aSim = calculateStringSimilarity(normalizeStr(s.name), normalizeStr(alias));
          if (aSim >= 0.65) {
            return { school: s, matchType: 'OUTCODE_ALIAS_MATCH', confidence: 0.85 };
          }
        }
      }
    }
  }

  // Tier 4: High name similarity across all schools within same school type or region
  let bestNameMatch = null;
  let highestScore = 0;

  for (const s of allDbSchools) {
    // Exact raw name match
    if (s.name.toLowerCase().trim() === rankedEntry.name.toLowerCase().trim()) {
      return { school: s, matchType: 'NAME_EXACT', confidence: 0.95 };
    }

    const normS = normalizeStr(s.name);
    if (normS && normS === targetNormName) {
      return { school: s, matchType: 'NORM_NAME_EXACT', confidence: 0.90 };
    }

    const sim = calculateStringSimilarity(normS, targetNormName);
    if (sim > highestScore) {
      highestScore = sim;
      bestNameMatch = s;
    }

    if (Array.isArray(rankedEntry.aliases)) {
      for (const alias of rankedEntry.aliases) {
        const aSim = calculateStringSimilarity(normS, normalizeStr(alias));
        if (aSim > highestScore) {
          highestScore = aSim;
          bestNameMatch = s;
        }
      }
    }
  }

  if (bestNameMatch && highestScore >= 0.78) {
    return { school: bestNameMatch, matchType: 'FUZZY_NAME', confidence: highestScore };
  }

  return null;
}

/**
 * Synchronize Top 100 Rankings into SQLite database
 */
function syncTop100Rankings() {
  const sqlite = db.getDb();
  const allDbSchools = db.getAllSchools();

  const updateStmt = sqlite.prepare(`
    UPDATE schools
    SET gcse_rank_england = ?,
        a_level_rank_england = ?,
        national_rank_england = ?
    WHERE id = ?
  `);

  const updateCompletenessStmt = sqlite.prepare(`
    UPDATE schools
    SET completeness_score = ?
    WHERE id = ?
  `);

  const results = {
    totalInDataset: TOP_RANKED_SCHOOLS_DATASET.length,
    matchedCount: 0,
    updatedCount: 0,
    unmatchedCount: 0,
    matches: [],
    unmatched: []
  };

  // Reset any legacy/stale ranks so only authentic, verified top schools hold rankings
  sqlite.prepare('UPDATE schools SET gcse_rank_england = NULL, a_level_rank_england = NULL, national_rank_england = NULL WHERE gcse_rank_england IS NOT NULL OR a_level_rank_england IS NOT NULL OR national_rank_england IS NOT NULL').run();

  sqlite.exec('BEGIN TRANSACTION');
  try {
    for (const entry of TOP_RANKED_SCHOOLS_DATASET) {
      const matchResult = findMatchingDbSchool(entry, allDbSchools);

      if (matchResult && matchResult.school) {
        const matchedSchool = matchResult.school;
        results.matchedCount++;

        const gcseVal = (entry.gcseRank !== null && entry.gcseRank !== undefined) ? parseInt(entry.gcseRank, 10) : null;
        const aLevelVal = (entry.aLevelRank !== null && entry.aLevelRank !== undefined) ? parseInt(entry.aLevelRank, 10) : null;
        const nationalVal = (entry.nationalRank !== null && entry.nationalRank !== undefined) ? parseInt(entry.nationalRank, 10) : (gcseVal || aLevelVal || null);

        updateStmt.run(gcseVal, aLevelVal, nationalVal, matchedSchool.id);
        results.updatedCount++;

        // Re-evaluate completeness score for updated school
        const updatedSchoolObj = {
          ...matchedSchool,
          gcse_rank_england: gcseVal,
          a_level_rank_england: aLevelVal,
          national_rank_england: nationalVal
        };

        if (completenessEngine && typeof completenessEngine.evaluateSchoolCompleteness === 'function') {
          const evalRes = completenessEngine.evaluateSchoolCompleteness(updatedSchoolObj);
          if (evalRes && typeof evalRes.percentage === 'number') {
            updateCompletenessStmt.run(evalRes.percentage, matchedSchool.id);
          }
        }

        results.matches.push({
          rankedName: entry.name,
          dbName: matchedSchool.name,
          schoolId: matchedSchool.id,
          postcode: matchedSchool.postcode,
          matchType: matchResult.matchType,
          gcseRank: gcseVal,
          aLevelRank: aLevelVal,
          nationalRank: nationalVal
        });
      } else if (entry.urn) {
        const gcseVal = (entry.gcseRank !== null && entry.gcseRank !== undefined) ? parseInt(entry.gcseRank, 10) : null;
        const aLevelVal = (entry.aLevelRank !== null && entry.aLevelRank !== undefined) ? parseInt(entry.aLevelRank, 10) : null;
        const nationalVal = (entry.nationalRank !== null && entry.nationalRank !== undefined) ? parseInt(entry.nationalRank, 10) : (gcseVal || aLevelVal || null);
        const newId = `sch-gov-${entry.urn}`;

        db.insertSchool({
          id: newId,
          name: entry.name,
          urn: entry.urn,
          postcode: entry.postcode,
          region: entry.region || 'Greater London / UK',
          la: entry.town || 'London',
          schoolType: entry.schoolType || 'Grammar',
          gcse_rank_england: gcseVal,
          a_level_rank_england: aLevelVal,
          national_rank_england: nationalVal,
          official: 1,
          officialDataSource: 'Sunday Times Parent Power & DfE League Tables',
          verification_status: 'official'
        });

        results.matchedCount++;
        results.updatedCount++;
        results.matches.push({
          rankedName: entry.name,
          dbName: entry.name,
          schoolId: newId,
          postcode: entry.postcode,
          matchType: 'INSERTED_OFFICIAL',
          gcseRank: gcseVal,
          aLevelRank: aLevelVal,
          nationalRank: nationalVal
        });
      } else {
        results.unmatchedCount++;
        results.unmatched.push({
          name: entry.name,
          postcode: entry.postcode,
          schoolType: entry.schoolType,
          urn: entry.urn
        });
      }
    }
    sqlite.exec('COMMIT');
  } catch (err) {
    sqlite.exec('ROLLBACK');
    throw err;
  }

  return results;
}

/**
 * Get current ranking status from SQLite
 */
function getRankingsStatus() {
  const sqlite = db.getDb();

  const totalSchools = sqlite.prepare('SELECT COUNT(*) as count FROM schools').get().count;
  const totalGcseRanked = sqlite.prepare('SELECT COUNT(*) as count FROM schools WHERE gcse_rank_england IS NOT NULL AND gcse_rank_england <= 100').get().count;
  const totalALevelRanked = sqlite.prepare('SELECT COUNT(*) as count FROM schools WHERE a_level_rank_england IS NOT NULL AND a_level_rank_england <= 100').get().count;
  const totalNationalRanked = sqlite.prepare('SELECT COUNT(*) as count FROM schools WHERE national_rank_england IS NOT NULL AND national_rank_england <= 100').get().count;

  const topGcse = sqlite.prepare(`
    SELECT id, name, postcode, schoolType, gcse_rank_england, a_level_rank_england, national_rank_england
    FROM schools
    WHERE gcse_rank_england IS NOT NULL
    ORDER BY gcse_rank_england ASC
    LIMIT 10
  `).all();

  const topALevel = sqlite.prepare(`
    SELECT id, name, postcode, schoolType, gcse_rank_england, a_level_rank_england, national_rank_england
    FROM schools
    WHERE a_level_rank_england IS NOT NULL
    ORDER BY a_level_rank_england ASC
    LIMIT 10
  `).all();

  return {
    totalSchools,
    totalGcseRanked,
    totalALevelRanked,
    totalNationalRanked,
    topGcse,
    topALevel
  };
}

if (require.main === module) {
  console.log('=== Running Top 100 UK School Rankings Synchronizer ===\n');
  const res = syncTop100Rankings();
  console.log(`Matched and updated: ${res.matchedCount} / ${res.totalInDataset} ranked schools.`);
  if (res.unmatched.length > 0) {
    console.log(`Unmatched schools (${res.unmatched.length}):`, res.unmatched);
  }
  const status = getRankingsStatus();
  console.log('\nUpdated Database Rankings Status:');
  console.log(`- GCSE Top 100 in DB: ${status.totalGcseRanked}`);
  console.log(`- A-Level Top 100 in DB: ${status.totalALevelRanked}`);
  console.log(`- National Top 100 in DB: ${status.totalNationalRanked}`);
}

module.exports = {
  findMatchingDbSchool,
  syncTop100Rankings,
  getRankingsStatus
};
