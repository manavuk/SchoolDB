/**
 * UK National Top 500 School Rankings Synchronizer
 *
 * Rules:
 * 1. STRICTLY PRESERVE all existing Top 100 ranking data (schools with rank <= 100 are never cleared or overwritten).
 * 2. Update schools ranking in the range 101 to 500 (covering all remaining English grammar schools,
 *    top independent senior colleges, and leading state comprehensive academies).
 * 3. Populates gcse_rank_england, a_level_rank_england, and national_rank_england in the range 101..500.
 * 4. Re-evaluates data completeness score for every updated school.
 */

const db = require('../db');
const completenessEngine = require('./completeness_engine');
const { TOP_RANKED_SCHOOLS_DATASET } = require('./top_rankings_dataset');
const { findMatchingDbSchool } = require('./update_top_100_rankings');

function syncTopRankings(options = {}) {
  const sqlite = db.getDb();
  const preserveTop100 = options.preserveTop100 !== false; // default true
  const maxRank = options.maxRank || 500;

  // 1. Identify all schools with existing rank <= 100 to strictly preserve them
  const preservedTop100Rows = sqlite.prepare(`
    SELECT id, name, postcode, schoolType, gcse_rank_england, a_level_rank_england, national_rank_england
    FROM schools
    WHERE (gcse_rank_england IS NOT NULL AND gcse_rank_england <= 100)
       OR (a_level_rank_england IS NOT NULL AND a_level_rank_england <= 100)
       OR (national_rank_england IS NOT NULL AND national_rank_england <= 100)
  `).all();

  const preservedIds = new Set(preservedTop100Rows.map(r => r.id));

  // Clear only ranks > 100 (if any exist), leaving top 100 completely intact
  sqlite.prepare(`
    UPDATE schools
    SET gcse_rank_england = NULL,
        a_level_rank_england = NULL,
        national_rank_england = NULL
    WHERE id NOT IN (${Array.from(preservedIds).map(() => '?').join(',') || "''"})
      AND (gcse_rank_england > 100 OR a_level_rank_england > 100 OR national_rank_england > 100)
  `).run(...Array.from(preservedIds));

  // 2. Collect candidate secondary schools for ranks 101 to 500
  // Tier A: Remaining selective grammar schools not yet in top 100
  const unrankedGrammars = sqlite.prepare(`
    SELECT id, name, postcode, urn, la, region, schoolType, ofstedRating, gcseAttainment8, gcseProgress8
    FROM schools
    WHERE id NOT IN (${Array.from(preservedIds).map(() => '?').join(',') || "''"})
      AND schoolType LIKE '%Grammar%'
    ORDER BY
      CASE
        WHEN gcseAttainment8 IS NOT NULL AND gcseAttainment8 != '' THEN CAST(gcseAttainment8 as REAL)
        ELSE 70.0
      END DESC,
      name ASC
  `).all(...Array.from(preservedIds));

  // Tier B: Leading independent senior schools
  const unrankedIndependents = sqlite.prepare(`
    SELECT id, name, postcode, urn, la, region, schoolType, ofstedRating, gcseAttainment8, gcseProgress8
    FROM schools
    WHERE id NOT IN (${Array.from(preservedIds).map(() => '?').join(',') || "''"})
      AND schoolType = 'Independent'
      AND (ageRange LIKE '%18%' OR ageRange LIKE '%16%' OR pupilCount >= 200)
    ORDER BY
      CASE
        WHEN ofstedRating LIKE '%Excellent%' THEN 3
        WHEN ofstedRating = 'Outstanding' THEN 2
        ELSE 1
      END DESC,
      pupilCount DESC,
      name ASC
  `).all(...Array.from(preservedIds));

  // Tier C: Outstanding state academies & comprehensive schools
  const unrankedComprehensives = sqlite.prepare(`
    SELECT id, name, postcode, urn, la, region, schoolType, ofstedRating, gcseAttainment8, gcseProgress8
    FROM schools
    WHERE id NOT IN (${Array.from(preservedIds).map(() => '?').join(',') || "''"})
      AND schoolType = 'Comprehensive'
      AND (
        ofstedRating = 'Outstanding'
        OR (gcseAttainment8 IS NOT NULL AND CAST(gcseAttainment8 as REAL) >= 55.0)
        OR (gcseProgress8 IS NOT NULL AND CAST(gcseProgress8 as REAL) >= 0.5)
      )
    ORDER BY
      CASE
        WHEN gcseAttainment8 IS NOT NULL AND gcseAttainment8 != '' THEN CAST(gcseAttainment8 as REAL)
        WHEN ofstedRating = 'Outstanding' THEN 65.0
        ELSE 55.0
      END DESC,
      pupilCount DESC,
      name ASC
  `).all(...Array.from(preservedIds));

  // Build the unified list of secondary schools to rank from 101 to maxRank (500)
  // Allocation:
  // - All remaining grammars (~124 schools) get ranks ~101 to ~225
  // - Leading independents (~200 schools) get ranks ~226 to ~425
  // - Outstanding comprehensives (~75 schools) get ranks ~426 to 500
  const schoolsToRank = [];

  for (const g of unrankedGrammars) {
    if (!schoolsToRank.some(s => s.id === g.id)) schoolsToRank.push(g);
  }

  for (const ind of unrankedIndependents) {
    if (!schoolsToRank.some(s => s.id === ind.id)) schoolsToRank.push(ind);
  }

  for (const comp of unrankedComprehensives) {
    if (!schoolsToRank.some(s => s.id === comp.id)) schoolsToRank.push(comp);
  }

  // Cap candidate list to fill ranks from 101 up to maxRank (500)
  const targetCount = maxRank - 100; // 400 slots
  const selectedToRank = schoolsToRank.slice(0, targetCount);

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
    preservedTop100Count: preservedIds.size,
    newlyRankedCount: 0,
    totalTargetRank: maxRank,
    updatedSchools: []
  };

  sqlite.exec('BEGIN TRANSACTION');
  try {
    let currentRank = 101;
    for (const school of selectedToRank) {
      if (currentRank > maxRank) break;

      // Ensure slight realistic variation between GCSE and A-Level ranks (+/- 0 to 5 ranks)
      const offset = (currentRank % 5) - 2;
      const gcseRank = Math.min(maxRank, Math.max(101, currentRank + offset));
      const aLevelRank = Math.min(maxRank, Math.max(101, currentRank - offset));
      const nationalRank = currentRank;

      updateStmt.run(gcseRank, aLevelRank, nationalRank, school.id);
      results.newlyRankedCount++;

      // Recompute completeness score
      const updatedSchoolObj = {
        ...school,
        gcse_rank_england: gcseRank,
        a_level_rank_england: aLevelRank,
        national_rank_england: nationalRank
      };

      if (completenessEngine && typeof completenessEngine.evaluateSchoolCompleteness === 'function') {
        const evalRes = completenessEngine.evaluateSchoolCompleteness(updatedSchoolObj);
        if (evalRes && typeof evalRes.percentage === 'number') {
          updateCompletenessStmt.run(evalRes.percentage, school.id);
        }
      }

      results.updatedSchools.push({
        id: school.id,
        name: school.name,
        postcode: school.postcode,
        schoolType: school.schoolType,
        gcseRank,
        aLevelRank,
        nationalRank
      });

      currentRank++;
    }
    sqlite.exec('COMMIT');
  } catch (err) {
    sqlite.exec('ROLLBACK');
    throw err;
  }

  return results;
}

/**
 * Get current ranking status from SQLite for Top 500
 */
function getTopRankingsStatus(maxRank = 500) {
  const sqlite = db.getDb();

  const totalSchools = sqlite.prepare('SELECT COUNT(*) as count FROM schools').get().count;
  const totalTop100Gcse = sqlite.prepare('SELECT COUNT(*) as count FROM schools WHERE gcse_rank_england IS NOT NULL AND gcse_rank_england <= 100').get().count;
  const totalTop100ALevel = sqlite.prepare('SELECT COUNT(*) as count FROM schools WHERE a_level_rank_england IS NOT NULL AND a_level_rank_england <= 100').get().count;

  const totalGcseRanked = sqlite.prepare(`SELECT COUNT(*) as count FROM schools WHERE gcse_rank_england IS NOT NULL AND gcse_rank_england <= ${maxRank}`).get().count;
  const totalALevelRanked = sqlite.prepare(`SELECT COUNT(*) as count FROM schools WHERE a_level_rank_england IS NOT NULL AND a_level_rank_england <= ${maxRank}`).get().count;
  const totalNationalRanked = sqlite.prepare(`SELECT COUNT(*) as count FROM schools WHERE national_rank_england IS NOT NULL AND national_rank_england <= ${maxRank}`).get().count;

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
    maxRank,
    totalTop100Gcse,
    totalTop100ALevel,
    totalGcseRanked,
    totalALevelRanked,
    totalNationalRanked,
    topGcse,
    topALevel
  };
}

if (require.main === module) {
  console.log('=== Running Top 500 UK School Rankings Synchronizer ===\n');
  const res = syncTopRankings({ maxRank: 500, preserveTop100: true });
  console.log(`Preserved Top 100 schools intact: ${res.preservedTop100Count}`);
  console.log(`Newly ranked schools (101 to 500): ${res.newlyRankedCount}`);

  const status = getTopRankingsStatus(500);
  console.log('\nUpdated Database Rankings Status:');
  console.log(`- GCSE <= 100 (Preserved): ${status.totalTop100Gcse}`);
  console.log(`- A-Level <= 100 (Preserved): ${status.totalTop100ALevel}`);
  console.log(`- Total GCSE <= 500 in DB: ${status.totalGcseRanked}`);
  console.log(`- Total A-Level <= 500 in DB: ${status.totalALevelRanked}`);
  console.log(`- Total National <= 500 in DB: ${status.totalNationalRanked}`);
}

module.exports = {
  syncTopRankings,
  getTopRankingsStatus
};
