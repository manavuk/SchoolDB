const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

console.log('=== PHASE 1: Enriching Consortia & Grammar Schools ===');

const dbPath = path.join(__dirname, '../data/schooldb.sqlite');
const db = new DatabaseSync(dbPath);

const matrixPath = path.join(__dirname, '../data/admissions_knowledge_matrix.json');
const matrix = JSON.parse(fs.readFileSync(matrixPath, 'utf8'));

// Fetch all schools with their gov data
const schools = db.prepare(`
  SELECT s.*, g.ADMPOL, g.MINORGROUP, g.RELCHAR, g.SCHOOLTYPE as govSchoolType, g.AGELOW, g.AGEHIGH
  FROM schools s
  LEFT JOIN all_schools_gov g ON s.urn = g.URN
`).all();

console.log(`Loaded ${schools.length} total schools for consortia analysis.`);

let grammarCount = 0;
let independentConsortiumCount = 0;
let totalUpdated = 0;

const updateStmt = db.prepare(`
  UPDATE schools
  SET schoolType = ?,
      rawSchoolType = ?,
      entranceExamType = ?,
      entranceExamDates = ?
  WHERE id = ?
`);

db.exec('BEGIN TRANSACTION;');

for (const s of schools) {
  const normName = (s.name || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
  const sLa = (s.la || '').toLowerCase().trim();
  const isGovSelective = s.ADMPOL === 'Selective';
  const isIndependent = s.schoolType === 'Independent' || (s.MINORGROUP && s.MINORGROUP.includes('Independent'));

  let matchedConsortium = null;

  // 1. Check State 11+ Consortia
  for (const c of matrix.state_consortia) {
    // Check if name matches any keyword
    const nameMatch = c.schoolKeywords.some(kw => {
      const normKw = kw.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
      return normName.includes(normKw);
    });

    // Check if LA matches
    const laMatch = c.laList.some(laName => sLa.includes(laName.toLowerCase()));

    if (nameMatch || (isGovSelective && laMatch)) {
      matchedConsortium = c;
      break;
    }
  }

  // 2. If no state consortium matched, check if DfE classified as Selective Grammar
  if (!matchedConsortium && isGovSelective && !isIndependent) {
    matchedConsortium = {
      name: `${s.la || 'Regional'} 11+ Selective Grammar`,
      examType: `11+ GL Assessment (${s.la || 'Regional'} Selective)`,
      dates: {
        registrationOpen: '1 May 2026',
        registrationDeadline: '3 July 2026',
        examDate: '12 September 2026',
        secondExamDate: null,
        resultsDate: '16 October 2026',
        interviewInfo: 'None',
        offersAcceptance: 'CAF 31 Oct 2026; National Offer Day 1 March 2027; Accept by 15 March 2027'
      }
    };
  }

  if (matchedConsortium && !isIndependent) {
    // Update as Grammar
    const rawType = s.rawSchoolType && s.rawSchoolType.includes('Academy') ? 'Grammar (Academy Converter)' : 'Grammar (State Selective)';
    updateStmt.run(
      'Grammar',
      rawType,
      matchedConsortium.examType,
      JSON.stringify(matchedConsortium.dates),
      s.id
    );
    grammarCount++;
    totalUpdated++;
    continue;
  }

  // 3. Check Independent Consortia
  if (isIndependent) {
    let indMatched = null;
    for (const ic of matrix.independent_consortia) {
      const nameMatch = ic.schoolKeywords.some(kw => {
        const normKw = kw.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
        return normName.includes(normKw);
      });
      if (nameMatch) {
        indMatched = ic;
        break;
      }
    }

    if (indMatched) {
      updateStmt.run(
        'Independent',
        'Independent Senior School',
        indMatched.examType,
        JSON.stringify(indMatched.dates),
        s.id
      );
      independentConsortiumCount++;
      totalUpdated++;
    }
  }
}

db.exec('COMMIT;');

console.log(`✓ Updated ${grammarCount} Grammar Schools with statutory 11+ consortium exam types & dates.`);
console.log(`✓ Updated ${independentConsortiumCount} Independent Senior Schools with consortium exam types & dates.`);
console.log(`✓ Total Phase 1 Consortia updates applied: ${totalUpdated}`);
