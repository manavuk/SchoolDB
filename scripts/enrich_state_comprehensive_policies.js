const { DatabaseSync } = require('node:sqlite');
const path = require('path');

console.log('=== PHASE 2: Enriching State Comprehensive & Academy Admissions Policies ===');

const dbPath = path.join(__dirname, '../data/schooldb.sqlite');
const db = new DatabaseSync(dbPath);

const stateSchools = db.prepare(`
  SELECT s.*, g.ADMPOL, g.MINORGROUP, g.RELCHAR, g.SCHOOLTYPE as govSchoolType, g.AGELOW, g.AGEHIGH
  FROM schools s
  LEFT JOIN all_schools_gov g ON s.urn = g.URN
  WHERE s.schoolType = 'Comprehensive'
`).all();

console.log(`Loaded ${stateSchools.length} Comprehensive schools for statutory policy assignment.`);

const standardStateDates = {
  registrationOpen: '1 September 2026',
  registrationDeadline: '31 October 2026',
  examDate: 'N/A (Non-selective Admissions)',
  secondExamDate: null,
  resultsDate: '1 March 2027',
  interviewInfo: 'None',
  offersAcceptance: '15 March 2027'
};

const faithStateDates = {
  registrationOpen: '1 September 2026',
  registrationDeadline: '31 October 2026',
  examDate: 'N/A (Faith Priority Criteria)',
  secondExamDate: null,
  resultsDate: '1 March 2027',
  interviewInfo: 'None (Supplementary Information Form [SIF] Required)',
  offersAcceptance: '15 March 2027'
};

const bandingStateDates = {
  registrationOpen: '1 September 2026',
  registrationDeadline: '31 October 2026',
  examDate: '14 November 2026',
  secondExamDate: null,
  resultsDate: '1 March 2027',
  interviewInfo: 'None',
  offersAcceptance: '15 March 2027'
};

const aptitudeStateDates = {
  registrationOpen: '1 September 2026',
  registrationDeadline: '11 September 2026',
  examDate: '3 October 2026',
  secondExamDate: null,
  resultsDate: '1 March 2027',
  interviewInfo: 'Audition / Practical Assessment (if applicable)',
  offersAcceptance: '15 March 2027'
};

let standardCount = 0;
let faithCount = 0;
let bandingCount = 0;
let aptitudeCount = 0;

const updateStmt = db.prepare(`
  UPDATE schools
  SET rawSchoolType = ?,
      entranceExamType = ?,
      entranceExamDates = ?
  WHERE id = ?
`);

db.exec('BEGIN TRANSACTION;');

for (const s of stateSchools) {
  const normName = (s.name || '').toLowerCase();
  const relChar = (s.RELCHAR || '').trim();
  const minorGroup = s.MINORGROUP || (s.rawSchoolType && !s.rawSchoolType.includes('Comprehensive') ? s.rawSchoolType : 'Academy Converter');

  const hasFaith = relChar && !['None', 'Does not apply', 'Not applicable'].includes(relChar);
  const isBanding = normName.includes('academy') && (normName.includes('city') || normName.includes('harris') || normName.includes('ark') || normName.includes('oasis') || normName.includes('mossbourne'));
  const isAptitude = normName.includes('performing arts') || normName.includes('music') || normName.includes('technology') || normName.includes('sports') || normName.includes('maths and science') || normName.includes('bilingual');

  let examType = 'Non-selective (Distance & Sibling Criteria - Local Authority CAF)';
  let datesObj = standardStateDates;
  let rawType = minorGroup;

  if (isAptitude) {
    examType = 'Specialist Aptitude Assessment (Aptitude test up to 10% under School Admissions Code)';
    datesObj = aptitudeStateDates;
    rawType = `${minorGroup} (Specialist Aptitude Stream)`;
    aptitudeCount++;
  } else if (hasFaith) {
    examType = `Faith-based Admissions (${relChar} - Supplementary Information Form [SIF] Required)`;
    datesObj = faithStateDates;
    rawType = `${minorGroup} (${relChar})`;
    faithCount++;
  } else if (isBanding) {
    examType = 'Fair Banding Assessment (Non-selective NFER/GL Banding Test)';
    datesObj = bandingStateDates;
    rawType = `${minorGroup} (Fair Banding)`;
    bandingCount++;
  } else {
    standardCount++;
  }

  updateStmt.run(
    rawType,
    examType,
    JSON.stringify(datesObj),
    s.id
  );
}

db.exec('COMMIT;');

console.log(`✓ Enriched ${standardCount} Standard Non-Selective State Schools.`);
console.log(`✓ Enriched ${faithCount} Faith-Based State Schools (SIF Criteria).`);
console.log(`✓ Enriched ${bandingCount} Fair Banding Academies.`);
console.log(`✓ Enriched ${aptitudeCount} Specialist Aptitude State Schools.`);
console.log(`✓ Total Comprehensive schools enriched: ${stateSchools.length}`);
